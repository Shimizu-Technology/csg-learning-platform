# Batch approval (POST /api/v1/submissions/batch_grade): one passing grade for
# several ungraded latest attempts, each saved exactly as a single review
# saves it (SubmissionGradeWriter).
#
# Only Pass (on Pass / Redo curricula) and B (on A / B / C / Redo) are allowed:
# Redo needs feedback written for that student, and A or C is a judgement on
# one piece of work. Rubric exercises are graded one at a time so every
# criterion is rated.
#
# Lock order is the canonical one (Curriculum.lock_for_content!), taken for the
# whole batch in ascending id order at each level:
#   1. curricula FOR SHARE (a scale change waits, or this reads the new scale),
#   2. enrollments FOR NO KEY UPDATE (the learning write guard),
#   3. submissions FOR NO KEY UPDATE.
# Every item is then checked under those locks. An item that fails a check is
# skipped with a reason; the others are graded. Notifications and post-commit
# work run after the transaction commits.
class SubmissionBatchGrade
  MAX_ITEMS = 50
  GRADES = %w[P B].freeze
  GRADE_INVALID = "Batch approval only supports Pass or B grades. Grade Redo, A, or C individually.".freeze
  NONE_GRADED = "None of the selected submissions could be approved.".freeze

  # Unknown ids and ids outside the viewer's cohorts read the same, so a
  # skipped reason never reveals that a submission exists.
  REASONS = {
    "not_found" => "Submission not found.",
    "superseded" => "A newer attempt was submitted. Review the latest attempt.",
    "already_graded" => "This submission was already graded.",
    "stale" => "This submission changed after you opened it. Reload and review it again.",
    "content_moved" => "This exercise moved to its cohort's own copy. Reload and review it again.",
    "learning_state_reset" => "This student's class progress was restarted. Reload and review it again.",
    "off_scale" => "This course's grading scale doesn't use that grade. Reload and review it again.",
    "rubric" => "Requires individual rubric grading."
  }.freeze

  Item = Data.define(:submission_id, :base_updated_at)

  class Invalid < StandardError; end

  # Raises Invalid with a message for a 422 when the request itself is malformed.
  def self.parse_items(raw)
    raise Invalid, "Choose at least one submission to approve." unless raw.is_a?(Array) && raw.any?
    raise Invalid, "Approve at most #{MAX_ITEMS} submissions at a time." if raw.length > MAX_ITEMS

    items = raw.map do |entry|
      entry = entry.to_unsafe_h if entry.respond_to?(:to_unsafe_h)
      raise Invalid, "Each item needs a submission_id and base_submission_updated_at." unless entry.is_a?(Hash)

      id = entry["submission_id"]
      raise Invalid, "Each submission_id must be a positive integer." unless id.is_a?(Integer) && id.positive?

      stamp = entry["base_submission_updated_at"]
      base = begin
        Time.iso8601(stamp) if stamp.is_a?(String)
      rescue ArgumentError
        nil
      end
      raise Invalid, "Each base_submission_updated_at must be an ISO 8601 timestamp." unless base

      Item.new(submission_id: id, base_updated_at: base)
    end
    raise Invalid, "Each submission can appear only once." if items.map(&:submission_id).uniq.length != items.length

    items
  end

  def initialize(viewer:, grade:, feedback:, items:, request_started_at:, school_features: FeatureSwitches.school(read_only: true))
    @viewer = viewer
    @grade = grade
    @feedback = Submission.blank_feedback?(feedback) ? nil : feedback
    @items = items
    @request_started_at = request_started_at
    @school_features = school_features
    @scope = StaffCohortScope.new(viewer)
    @skipped = {}
  end

  def call
    writers = []
    ApplicationRecord.uncached do
      candidates = read_candidates
      next if candidates.empty?

      Submission.transaction do
        scales = Curriculum.where(id: candidates.values.map { |row| row[:curriculum_id] }.uniq.sort).order(:id)
          .lock("FOR SHARE").pluck(:id, :grading_scale).to_h
        enrollments = Enrollment.includes(:cohort).where(id: candidates.values.map { |row| row[:enrollment_id] }.uniq.sort)
          .order(:id).lock("FOR NO KEY UPDATE").index_by(&:id)
        submissions = Submission
          .includes(:user, :submission_grade_suggestion, enrollment: :cohort, content_block: { lesson: { curriculum_module: :curriculum } })
          .where(id: candidates.keys.sort).order(:id).lock("FOR NO KEY UPDATE").to_a
        latest_ids = Submission.latest_attempt_ids_for(submissions)
        found = submissions.index_by(&:id)

        candidates.keys.sort.each do |id|
          submission = found[id]
          reason = submission ? skip_reason(submission, candidates.fetch(id), scales, enrollments, latest_ids) : "not_found"
          next skip!(id, reason) if reason

          # The locked enrollment carries the guard state just checked.
          submission.enrollment = enrollments.fetch(submission.enrollment_id)
          writer = SubmissionGradeWriter.new(submission: submission, grader: @viewer, school_features: @school_features).prepare(@grade)
          writer.record!(grade: @grade, feedback: @feedback, grading_scale: scales.fetch(candidates.fetch(id)[:curriculum_id]),
            evaluate_completion: false)
          writers << writer
        end

        # Once per learner, after all of their grades: the same check a single grade runs.
        writers.map { |writer| writer.submission.enrollment }.uniq(&:id).sort_by(&:id).each do |enrollment|
          CourseCompletion.evaluate!(enrollment, actor: @viewer)
        end
      end
    end

    writers.each(&:deliver!)
    graded = writers.map do |writer|
      submission = writer.submission
      { submission_id: submission.id, user_id: submission.user_id, user_name: submission.user.full_name, grade: submission.grade,
        graded_at: submission.graded_at.iso8601(6), updated_at: submission.updated_at.iso8601(6) }
    end
    { graded: graded, skipped: @items.filter_map { |item| @skipped[item.submission_id] } }
  end

  private

  # Metadata for the items the viewer may grade (read without the query cache,
  # like everything here, so ids moved by a cohort copy are seen). Everything
  # is checked again under the locks.
  def read_candidates
    by_id = @items.index_by(&:submission_id)
    rows = Submission.joins(:enrollment, content_block: { lesson: :curriculum_module })
      .where(id: by_id.keys)
      .pluck("submissions.id", "submissions.enrollment_id", "enrollments.cohort_id", "modules.curriculum_id")
    candidates = rows.select { |_, _, cohort_id, _| @scope.visible?(cohort_id) }.to_h do |id, enrollment_id, _, curriculum_id|
      [ id, { enrollment_id: enrollment_id, curriculum_id: curriculum_id, base_updated_at: by_id.fetch(id).base_updated_at } ]
    end
    @items.each { |item| skip!(item.submission_id, "not_found") unless candidates.key?(item.submission_id) }
    candidates
  end

  def skip_reason(submission, candidate, scales, enrollments, latest_ids)
    enrollment = enrollments[submission.enrollment_id]
    return "not_found" unless enrollment && submission.enrollment_id == candidate[:enrollment_id] && @scope.visible?(enrollment.cohort_id)

    stale = enrollment.stale_learning_write(request_started_at: @request_started_at)
    return stale.code == "content_moved" ? "content_moved" : "learning_state_reset" if stale
    # A cohort copy moved this work to its own curriculum after it was read:
    # the scale locked above is the wrong one.
    return "content_moved" unless submission.content_block.lesson.curriculum_module.curriculum_id == candidate[:curriculum_id]
    return "off_scale" unless Curriculum.grades_for_scale(scales.fetch(candidate[:curriculum_id])).include?(@grade)
    return "superseded" unless latest_ids[submission.attempt_key] == submission.id
    return "already_graded" unless submission.grade.nil?
    return "stale" unless submission.updated_at == candidate[:base_updated_at]

    "rubric" unless submission.content_block.rubric_id.nil?
  end

  def skip!(id, code)
    @skipped[id] ||= { submission_id: id, code: code, reason: REASONS.fetch(code) }
  end
end
