require "digest"

# Import reusable teaching material only. Enrollment, access, payments and media
# remain separate staff actions. Package keys never identify legacy curricula.
class CoursePackageImporter
  class InvalidPackage < StandardError; end
  MAX_BYTES = 2.megabytes
  IDENTIFIER = /\A[a-z0-9][a-z0-9-]{0,79}\z/
  TEXT_LIMIT = 100_000

  def initialize(package)
    @package = package
    validate!
    @digest = Digest::SHA256.hexdigest(JSON.generate(@package))
  end

  def preview
    existing = Curriculum.find_by(course_package_key: @package.fetch("key"))
    validate_revision!(existing) if existing && existing.course_package_digest != @digest
    {
      key: @package.fetch("key"), revision: @package.fetch("revision"), title: @package.fetch("title"),
      modules: @package.fetch("modules").size,
      lessons: @package.fetch("modules").sum { |mod| mod.fetch("lessons").size },
      blocks: @package.fetch("modules").sum { |mod| mod.fetch("lessons").sum { |lesson| lesson.fetch("blocks").size } },
      existing_curriculum_id: existing&.id, unchanged: existing&.course_package_digest == @digest,
      status: existing&.status || "draft", assigned: existing&.cohorts&.exists? || false
    }
  end

  def call
    Curriculum.transaction do
      curriculum = Curriculum.lock.find_by(course_package_key: @package.fetch("key"))
      if curriculum
        return { curriculum_id: curriculum.id, unchanged: true } if curriculum.course_package_digest == @digest
        validate_revision!(curriculum)
      else
        curriculum = Curriculum.create!(name: @package.fetch("title"), status: :draft, course_package_key: @package.fetch("key"))
      end
      if curriculum.course_package_digest.present?
        lock_imported_content!(curriculum)
        verify_imported_content!(curriculum)
      end
      curriculum.update!(name: @package.fetch("title"), description: @package["description"], total_weeks: @package.fetch("total_weeks"), course_package_revision: @package.fetch("revision"), course_package_digest: @digest)
      existing_modules = curriculum.modules.index_by(&:course_package_key)
      missing_modules = existing_modules.keys.compact - @package.fetch("modules").map { |mod| mod.fetch("key") }
      raise InvalidPackage, "Package cannot remove existing modules" if missing_modules.any?
      @package.fetch("modules").each_with_index do |data, position|
        mod = existing_modules[data.fetch("key")] || curriculum.modules.build
        mod.update!(name: data.fetch("title"), description: data["description"], course_package_key: data.fetch("key"), module_type: :workshop, position: position, total_days: data.fetch("total_days"), day_offset: 0, schedule_days: data.fetch("schedule_days"))
        import_lessons(mod, data.fetch("lessons"))
      end
      curriculum.update!(course_package_content_snapshot: curriculum_fingerprint(curriculum))
      { curriculum_id: curriculum.id, unchanged: false }
    end
  rescue ActiveRecord::RecordInvalid => error
    raise InvalidPackage, error.record.errors.full_messages.join(", ")
  rescue ActiveRecord::Deadlocked, ActiveRecord::SerializationFailure, ActiveRecord::LockWaitTimeout
    raise InvalidPackage, "Content changed concurrently; preview the package again"
  rescue ActiveRecord::RecordNotUnique
    raise InvalidPackage, "This package was imported concurrently; preview it again"
  end

  private

  def import_lessons(mod, lessons)
    existing = mod.all_lessons.includes(:content_blocks).index_by { |lesson| lesson.content_blocks.first&.metadata&.fetch("package_lesson_key", nil) }
    raise InvalidPackage, "Package cannot remove existing lessons" if (existing.keys.compact - lessons.map { |lesson| lesson.fetch("key") }).any?
    lessons.each_with_index do |data, position|
      lesson = existing[data.fetch("key")] || mod.lessons.build
      lesson.update!(title: data.fetch("title"), lesson_type: data.fetch("lesson_type"), position: position, release_day: data.fetch("release_day"), required: data.fetch("required"), requires_submission: data.fetch("blocks").any? { |block| block.fetch("submission_type", "manual_complete") != "manual_complete" })
      blocks = lesson.content_blocks.index_by { |block| block.metadata["package_block_key"] }
      raise InvalidPackage, "Package cannot remove existing blocks" if (blocks.keys.compact - data.fetch("blocks").map { |block| block.fetch("key") }).any?
      data.fetch("blocks").each_with_index do |block, block_position|
        record = blocks[block.fetch("key")] || lesson.content_blocks.build
        record.assign_attributes(block_type: block.fetch("block_type"), position: block_position, title: block["title"], body: block["body"], solution: block["solution"], filename: block["filename"], submission_type: block.fetch("submission_type", "manual_complete"), metadata: (record.metadata || {}).merge("package_lesson_key" => data.fetch("key"), "package_block_key" => block.fetch("key"), "course_package_key" => @package.fetch("key")))
        record.rubric = import_rubric(record.rubric, block["rubric"], mod.curriculum)
        record.save!
      end
    end
  end

  def validate_revision!(curriculum)
    raise InvalidPackage, "Use a new revision for changed content" if curriculum.course_package_revision == @package.fetch("revision")
    raise InvalidPackage, "Assigned or active curricula must be revised through the content editor" if !curriculum.draft? || curriculum.cohorts.exists?
    verify_imported_content!(curriculum)
  end

  def import_rubric(existing, data, curriculum)
    raise InvalidPackage, "Package cannot remove an existing rubric" if existing && !data
    return unless data

    rubric = existing || curriculum.rubrics.build
    rubric.assign_attributes(title: data.fetch("title"), description: data["description"], active: true)
    rubric.rubric_criteria.destroy_all if rubric.persisted?
    data.fetch("criteria").each_with_index do |criterion, position|
      rubric.rubric_criteria.build(title: criterion.fetch("title"), description: criterion.fetch("description"), position: position)
    end
    rubric.save!
    rubric
  end

  def lock_imported_content!(curriculum)
    curriculum.rubrics.reorder(:id).lock.each { |rubric| rubric.rubric_criteria.reorder(:id).lock.load }
    curriculum.modules.reorder(:id).lock.each do |mod|
      mod.all_lessons.reorder(:id).lock.each do |lesson|
        lesson.content_blocks.reorder(:id).lock.load
      end
    end
  end

  def verify_imported_content!(curriculum)
    unless curriculum.course_package_content_snapshot == curriculum_fingerprint(curriculum)
      raise InvalidPackage, "Draft was edited after import; use the content editor to preserve those changes"
    end
  end

  def curriculum_fingerprint(curriculum)
    data = {
      curriculum: curriculum.attributes.slice("name", "description", "total_weeks"),
      rubrics: curriculum.rubrics.reload.order(:id).includes(:rubric_criteria).map do |rubric|
        { rubric: rubric.attributes.slice("id", "title", "description", "active"), criteria: rubric.rubric_criteria.order(:id).map { |criterion| criterion.attributes.slice("id", "title", "description", "position", "learning_objective_id") } }
      end,
      modules: curriculum.modules.reload.includes(all_lessons: :content_blocks).map do |mod|
        {
          module: mod.attributes.slice("id", "course_package_key", "name", "description", "position", "total_days", "day_offset", "schedule_days", "module_type"),
          lessons: mod.all_lessons.order(:id).map do |lesson|
            {
              lesson: lesson.attributes.slice("id", "title", "lesson_type", "position", "release_day", "required", "requires_submission", "archived_at"),
              blocks: lesson.content_blocks.order(:id).map do |block|
                block.attributes.slice("id", "block_type", "position", "title", "body", "solution", "filename", "submission_type", "submission_config", "rubric_id").merge("package_keys" => block.metadata.slice("package_lesson_key", "package_block_key", "course_package_key"))
              end
            }
          end
        }
      end
    }
    Digest::SHA256.hexdigest(JSON.generate(data))
  end

  def validate!
    fail_with("Package must be an object") unless @package.is_a?(Hash)
    fail_with("Package exceeds 2 MB") if JSON.generate(@package).bytesize > MAX_BYTES
    fail_with("Unsupported schema version") unless @package["schema_version"] == 1
    identifier!(@package["key"])
    text!(@package["revision"], 80, required: true)
    text!(@package["title"], 160, required: true)
    text!(@package["description"], TEXT_LIMIT)
    integer!(@package["total_weeks"], 1..52)
    list!(@package["modules"], 1..20)
    unique_keys!(@package["modules"])
    lesson_count = 0
    @package["modules"].each do |mod|
      object!(mod)
      identifier!(mod["key"])
      text!(mod["title"], 160, required: true)
      text!(mod["description"], TEXT_LIMIT)
      integer!(mod["total_days"], 1..365)
      fail_with("Invalid module schedule") unless CurriculumModule::SCHEDULE_PATTERNS.key?(mod["schedule_days"])
      list!(mod["lessons"], 1..250)
      unique_keys!(mod["lessons"])
      lesson_count += mod["lessons"].size
      mod["lessons"].each do |lesson|
        object!(lesson)
        identifier!(lesson["key"])
        text!(lesson["title"], 160, required: true)
        fail_with("Invalid lesson type") unless Lesson.lesson_types.key?(lesson["lesson_type"])
        integer!(lesson["release_day"], 0...mod["total_days"])
        fail_with("Release day is outside the schedule") unless CurriculumModule::SCHEDULE_PATTERNS.fetch(mod["schedule_days"]).include?(lesson["release_day"] % 7)
        fail_with("required must be true or false") unless [ true, false ].include?(lesson["required"])
        list!(lesson["blocks"], 1..20)
        unique_keys!(lesson["blocks"])
        lesson["blocks"].each do |block|
          object!(block)
          identifier!(block["key"])
          fail_with("Invalid block type") unless ContentBlock.block_types.key?(block["block_type"])
          fail_with("Invalid submission type") unless %w[manual_complete text_submission repo_url_submission repo_and_live_url_submission].include?(block.fetch("submission_type", "manual_complete"))
          %w[body solution].each { |field| text!(block[field], TEXT_LIMIT) }
          text!(block["title"], 160)
          text!(block["filename"], 160)
          validate_rubric!(block["rubric"]) if block.key?("rubric")
          fail_with("Media must be attached through the normal upload flow") if block.keys.any? { |key| key.match?(/video|s3/i) }
        end
      end
    end
    fail_with("Too many lessons") if lesson_count > 250
  end

  def validate_rubric!(rubric)
    object!(rubric)
    text!(rubric["title"], 160, required: true)
    text!(rubric["description"], TEXT_LIMIT)
    list!(rubric["criteria"], 1..12)
    rubric["criteria"].each do |criterion|
      object!(criterion)
      text!(criterion["title"], 160, required: true)
      text!(criterion["description"], 1_500, required: true)
    end
  end

  def fail_with(message)
    raise InvalidPackage, message
  end

  def object!(value)
    fail_with("Expected an object") unless value.is_a?(Hash)
  end

  def list!(value, range)
    fail_with("Invalid list size") unless value.is_a?(Array) && range.cover?(value.size)
  end

  def identifier!(value)
    fail_with("Invalid package key") unless value.is_a?(String) && IDENTIFIER.match?(value)
  end

  def text!(value, maximum, required: false)
    return if value.nil? && !required
    fail_with("Invalid or oversized text field") unless value.is_a?(String) && value.length <= maximum && (!required || value.strip.present?)
  end

  def integer!(value, range)
    fail_with("Invalid integer field") unless value.is_a?(Integer) && range.cover?(value)
  end

  def unique_keys!(values)
    values.each { |value| object!(value) }
    keys = values.map { |value| value["key"] }
    fail_with("Duplicate package keys") if keys.uniq.size != keys.size
  end
end
