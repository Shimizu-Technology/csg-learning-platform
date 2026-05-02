require "json"

class PreworkGraderArchiveImporter
  KNOWN_GRADES = {
    "A" => "A",
    "B" => "B",
    "C" => "C",
    "R" => "R"
  }.freeze

  attr_reader :report

  def initialize(json_path:, target_cohort:, module_name: "Prework", dry_run: true, overwrite: false, create_missing_users: false, create_missing_enrollments: false)
    @json_path = json_path
    @target_cohort = target_cohort
    @module_name = module_name
    @dry_run = dry_run
    @overwrite = overwrite
    @create_missing_users = create_missing_users
    @create_missing_enrollments = create_missing_enrollments
    @report = new_report
  end

  def call
    load_archive!
    validate_archive!
    load_destination!
    index_destination!

    import_students
    import_submissions

    report
  end

  private

  attr_reader :archive, :cohort, :curriculum_module, :content_blocks_by_filename, :users_by_email, :users_by_github

  def new_report
    {
      dry_run: @dry_run,
      overwrite: @overwrite,
      target: {},
      archive: {},
      students: {
        matched: 0,
        created: 0,
        missing: [],
        enrolled: 0,
        enrollment_missing: 0
      },
      exercises: {
        content_blocks_indexed: 0,
        unmatched_filenames: Hash.new(0)
      },
      submissions: {
        archive_rows: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        conflicts: [],
        unknown_grades: Hash.new(0)
      }
    }
  end

  def load_archive!
    raise ArgumentError, "Archive JSON not found: #{@json_path}" unless File.exist?(@json_path)

    @archive = JSON.parse(File.read(@json_path))
    report[:archive] = {
      cohort_name: archive.dig("cohort", "name"),
      students: archive.fetch("students", []).size,
      exercises: archive.fetch("exercises", []).size,
      submissions: archive.fetch("submissions", []).size,
      exported_at: archive.dig("metadata", "exported_at")
    }
  end

  def validate_archive!
    type = archive.dig("metadata", "archive_type")
    return if type == "csg_prework_grader_cohort_archive"

    raise ArgumentError, "Unexpected archive type: #{type.inspect}. Expected csg_prework_grader_cohort_archive."
  end

  def load_destination!
    @cohort = find_target_cohort!
    @curriculum_module = cohort.curriculum.modules.find_by!("LOWER(name) = ?", @module_name.downcase)

    report[:target] = {
      cohort_id: cohort.id,
      cohort_name: cohort.name,
      module_id: curriculum_module.id,
      module_name: curriculum_module.name
    }
  end

  def find_target_cohort!
    case @target_cohort
    when Integer
      Cohort.find(@target_cohort)
    else
      target = @target_cohort.to_s.strip
      raise ArgumentError, "TARGET_COHORT_ID or TARGET_COHORT_NAME is required" if target.blank?

      if target.match?(/\A\d+\z/)
        Cohort.find(target)
      else
        Cohort.find_by!("LOWER(name) = ?", target.downcase)
      end
    end
  end

  def index_destination!
    @content_blocks_by_filename = {}
    ContentBlock.joins(:lesson)
      .where(lessons: { module_id: curriculum_module.id })
      .where.not(filename: [ nil, "" ])
      .find_each do |block|
        content_blocks_by_filename[normalize_key(block.filename)] = block
      end
    report[:exercises][:content_blocks_indexed] = content_blocks_by_filename.size

    users = User.all.to_a
    @users_by_email = users.select { |user| user.email.present? }.index_by { |user| normalize_key(user.email) }
    @users_by_github = users.select { |user| user.github_username.present? }.index_by { |user| normalize_key(user.github_username) }
  end

  def import_students
    archive.fetch("students", []).each do |student_data|
      user = find_user_for_student(student_data)

      if user
        report[:students][:matched] += 1
        maybe_update_user(user, student_data)
        maybe_ensure_enrollment(user, student_data)
      elsif @create_missing_users
        report[:students][:created] += 1
        create_user(student_data)
      else
        report[:students][:missing] << student_identifier(student_data)
      end
    end
  end

  def find_user_for_student(student_data)
    email = normalize_key(student_data["email"])
    github = normalize_key(student_data["github_username"])

    users_by_email[email] || users_by_github[github]
  end

  def maybe_update_user(user, student_data)
    attrs = {}
    attrs[:first_name] = student_data["first_name"] if should_assign?(user.first_name, student_data["first_name"])
    attrs[:last_name] = student_data["last_name"] if should_assign?(user.last_name, student_data["last_name"])
    attrs[:github_username] = student_data["github_username"] if should_assign?(user.github_username, student_data["github_username"])

    return if attrs.empty? || @dry_run

    user.update!(attrs)
  end

  def maybe_ensure_enrollment(user, student_data)
    enrollment = Enrollment.find_by(user: user, cohort: cohort)
    if enrollment
      report[:students][:enrolled] += 1
      return
    end

    if @create_missing_enrollments
      report[:students][:enrolled] += 1
      return if @dry_run

      Enrollment.create!(
        user: user,
        cohort: cohort,
        status: active_student?(student_data) ? :active : :dropped,
        enrolled_at: Time.current
      )
    else
      report[:students][:enrollment_missing] += 1
    end
  end

  def create_user(student_data)
    return if @dry_run

    user = User.create!(
      email: student_data.fetch("email").downcase,
      first_name: student_data["first_name"],
      last_name: student_data["last_name"],
      github_username: student_data["github_username"],
      role: :student,
      clerk_id: "pending_#{SecureRandom.uuid}"
    )
    users_by_email[normalize_key(user.email)] = user
    users_by_github[normalize_key(user.github_username)] = user if user.github_username.present?
    maybe_ensure_enrollment(user, student_data)
  end

  def import_submissions
    archive.fetch("submissions", []).each do |submission_data|
      report[:submissions][:archive_rows] += 1
      import_submission(submission_data)
    end
  end

  def import_submission(submission_data)
    filename = normalize_key(submission_data["exercise_filename"])
    user = find_user_for_submission(submission_data)
    block = content_blocks_by_filename[filename]

    unless block && user
      report_skip(submission_data, filename, user, block)
      return
    end

    prework_grade = submission_data["grade"].to_s.presence
    grade = KNOWN_GRADES[prework_grade]
    if prework_grade.present? && grade.nil? && prework_grade != "+"
      report[:submissions][:unknown_grades][prework_grade] += 1
    end

    existing = Submission.find_by(user: user, content_block: block)
    if existing
      update_existing_submission(existing, submission_data, grade)
    else
      create_submission(user, block, submission_data, grade)
    end
  end

  def find_user_for_submission(submission_data)
    email = normalize_key(submission_data["student_email"])
    github = normalize_key(submission_data["student_github_username"])

    users_by_email[email] || users_by_github[github]
  end

  def report_skip(submission_data, filename, user, block)
    report[:submissions][:skipped] += 1
    report[:exercises][:unmatched_filenames][submission_data["exercise_filename"].to_s] += 1 if filename.present? && !block
    report[:students][:missing] << student_identifier(submission_data) unless user
  end

  def update_existing_submission(existing, submission_data, grade)
    attrs = submission_attrs(submission_data, grade, existing: existing)

    if attrs.empty?
      report[:submissions][:unchanged] += 1
      return
    end

    report_conflicts(existing, submission_data)
    report[:submissions][:updated] += 1
    return if @dry_run

    existing.update!(attrs)
    update_progress(existing.user, existing.content_block, grade, submission_data)
  end

  def create_submission(user, block, submission_data, grade)
    report[:submissions][:created] += 1
    return if @dry_run

    submission = Submission.create!(
      submission_attrs(submission_data, grade).merge(
        user: user,
        content_block: block,
        created_at: parse_time(submission_data["created_at"]) || Time.current,
        updated_at: parse_time(submission_data["updated_at"]) || Time.current
      )
    )
    update_progress(submission.user, submission.content_block, grade, submission_data)
  end

  def submission_attrs(submission_data, grade, existing: nil)
    attrs = { submission_type: :prework_github_sync }

    assign_if_allowed(attrs, :text, existing&.text, submission_data["text"])
    assign_if_allowed(attrs, :github_code_url, existing&.github_code_url, submission_data["github_code_url"])
    assign_if_allowed(attrs, :github_issue_url, existing&.github_issue_url, submission_data["github_issue_url"])

    existing_count = existing&.num_submissions.to_i
    archive_count = submission_data["num_submissions"].to_i
    attrs[:num_submissions] = [ existing_count, archive_count, 1 ].max if existing.nil? || @overwrite || archive_count > existing_count

    if grade.present? && (existing.nil? || @overwrite || existing.grade.blank?)
      attrs[:grade] = grade
      attrs[:graded_by_id] = grader_user&.id
      attrs[:graded_at] = parse_time(submission_data["updated_at"]) || Time.current
    end

    attrs
  end

  def assign_if_allowed(attrs, attr, current_value, archive_value)
    return if archive_value.blank?
    return if current_value.present? && !@overwrite

    attrs[attr] = archive_value
  end

  def report_conflicts(existing, submission_data)
    conflicts = []
    conflicts << "text" if existing.text.present? && submission_data["text"].present? && existing.text != submission_data["text"]
    conflicts << "grade" if existing.grade.present? && submission_data["grade"].present? && existing.grade != KNOWN_GRADES[submission_data["grade"].to_s]
    return if conflicts.empty?

    report[:submissions][:conflicts] << {
      user_email: existing.user.email,
      filename: existing.content_block.filename,
      fields: conflicts
    }
  end

  def update_progress(user, block, grade, submission_data)
    status = grade == "R" ? :in_progress : :completed
    progress = Progress.find_or_initialize_by(user: user, content_block: block)
    progress.status = status
    progress.completed_at = status == :completed ? (parse_time(submission_data["updated_at"]) || Time.current) : nil
    progress.save!
  end

  def grader_user
    @grader_user ||= User.admin.first || User.instructor.first
  end

  def should_assign?(current_value, archive_value)
    archive_value.present? && (@overwrite || current_value.blank?)
  end

  def active_student?(student_data)
    ActiveModel::Type::Boolean.new.cast(student_data["active"])
  end

  def normalize_key(value)
    value.to_s.strip.downcase.presence
  end

  def student_identifier(data)
    data["student_email"].presence || data["email"].presence || data["student_github_username"].presence || data["github_username"].presence || "unknown student"
  end

  def parse_time(value)
    Time.zone.parse(value.to_s) if value.present?
  rescue ArgumentError
    nil
  end
end
