# Copies a shared class item (file, link or Learn Doc) into a learner's own
# folder: "Copy to all students", and the automatic copies of items marked
# `auto_copy_to_students` (when it is turned on, when a cohort imports one,
# and when a learner enrolls or comes back).
#
# Every copy, whichever path makes it, names its class item in
# source_file_id, so index_cohort_files_one_copy_per_student keeps each
# learner to one copy: retries, a manual copy after an automatic one and two
# paths racing all end with one row.
#
# A file's bytes are copied in storage first, outside any transaction or row
# lock. The row is then inserted in a short transaction that locks the
# learner's enrollment (enrollment before file, the order Cohort#destroy
# takes) and rechecks that it is still active and unexpired. When that skips
# or fails (even ambiguously), the copied object is deleted or queued for a
# durable retry.
class CohortFileCopy
  Result = Struct.new(:copies, :skipped, keyword_init: true)

  class << self
    # Copies `source` to every active learner without one yet. `auto` copies
    # only while the item is still marked auto-copy when each copy is inserted.
    def to_active_students(source, actor:, folder: nil, auto: false)
      raise ArgumentError, "only shared class items are copied to students" unless copyable?(source)

      folder = folder.presence || source.folder
      copied = source.cohort.cohort_files.where(source_file_id: source.id).where.not(student_id: nil).pluck(:student_id).to_set
      copies = []
      skipped = 0
      source.cohort.enrollments.active.order(:id).pluck(:id, :user_id).each do |enrollment_id, student_id|
        copy = to_student(source, enrollment_id: enrollment_id, student_id: student_id, folder: folder, actor: actor, auto: auto) unless copied.include?(student_id)
        copy ? copies << copy : skipped += 1
      end
      Result.new(copies: copies, skipped: skipped)
    end

    # Copies every auto-copy class item this learner doesn't have yet. Never
    # raises: an enrollment is never undone because storage is missing or
    # failing; a skipped item is copied the next time this runs. A cohort
    # without auto-copy items costs one query. Each insert relocks and
    # rechecks the enrollment, so a stale `enrollment` copies nothing.
    def auto_copy_for_enrollment(enrollment)
      return 0 unless enrollment.active?

      sources = CohortFile.auto_copied.where(cohort_id: enrollment.cohort_id).order(:id).to_a
      return 0 if sources.empty?

      have = CohortFile.where(cohort_id: enrollment.cohort_id, student_id: enrollment.user_id, source_file_id: sources.map(&:id)).pluck(:source_file_id).to_set
      sources.reject { |source| have.include?(source.id) }.count do |source|
        next false if source.stored_file? && !S3Service.configured?

        to_student(source, enrollment_id: enrollment.id, student_id: enrollment.user_id, folder: source.folder, actor: nil, auto: true).present?
      rescue StandardError => error
        Rails.logger.error("[CohortFileCopy] auto_copy_failed source_id=#{source.id} enrollment_id=#{enrollment.id} #{error.class}")
        false
      end
    rescue StandardError => error
      Rails.logger.error("[CohortFileCopy] auto_copy_failed enrollment_id=#{enrollment.id} #{error.class}")
      0
    end

    # Auto-copies newly added class items to every active learner. Stored
    # files are skipped while storage is unavailable or failing (Enrollment's
    # hook and the next import or toggle copy them later); returns the copy count.
    def auto_copy_new_items(files, actor:)
      files.select { |file| file.auto_copy_to_students? && copyable?(file) }.sum do |file|
        next 0 if file.stored_file? && !S3Service.configured?

        to_active_students(file, actor: actor, auto: true).copies.size
      rescue StandardError => error
        Rails.logger.error("[CohortFileCopy] auto_copy_failed source_id=#{file.id} #{error.class}")
        0
      end
    end

    def copyable?(source)
      source.class_file? && source.ready? && !source.staff_only?
    end

    # One learner's copy, or nil when they are no longer active, already have
    # one, or the item stopped being shared (or auto-copied, with `auto`).
    def to_student(source, enrollment_id:, student_id:, folder:, actor:, auto: false)
      attributes = {
        kind: source.kind, student_id: student_id, uploaded_by_id: actor&.id || source.uploaded_by_id, source_file: source,
        title: source.title, description: source.description, folder: folder, visibility: "students", ready: true
      }
      return insert(source, enrollment_id, attributes.merge(external_url: source.external_url), auto) if source.link?
      if source.doc?
        return insert(source, enrollment_id, attributes.merge(doc_content: source.doc_content.to_s, doc_updated_at: Time.current, doc_updated_by_id: actor&.id), auto)
      end

      token = SecureRandom.uuid
      copy = source.cohort.cohort_files.new(attributes.merge(
        filename: source.filename, content_type: source.content_type, file_size: source.file_size,
        s3_key: "cohort_files/cohort_#{source.cohort_id}/student_#{student_id}/#{token}/#{source.filename}",
        upload_key: "cohort_file_uploads/cohort_#{source.cohort_id}/#{token}/#{source.filename}",
        upload_expires_at: Time.current
      ))
      copy.validate!
      begin
        S3Service.copy_object(source.s3_key, copy.s3_key)
        saved = insert(source, enrollment_id, copy, auto)
        remove_copied_object(copy.s3_key) unless saved
        saved
      rescue StandardError
        remove_copied_object(copy.s3_key)
        raise
      end
    end

    private

    # Inserts the copy with the learner's enrollment locked and still active
    # (not paused, dropped or past its deadline), then the class item held
    # FOR SHARE (Enrollment before CohortFile, the order every file write
    # takes) and rechecked: still a ready class item shared with students,
    # and still auto-copy for an automatic copy. A withdrawal committed while
    # storage was copying wins. nil otherwise, or when a concurrent copy got
    # there first.
    def insert(source, enrollment_id, copy, auto)
      Enrollment.transaction do
        recipient = Enrollment.lock.find_by(id: enrollment_id)
        next nil unless recipient&.active?

        current = CohortFile.lock("FOR SHARE").find_by(id: source.id)
        next nil unless current && copyable?(current) && (!auto || current.auto_copy_to_students?)

        copy = source.cohort.cohort_files.new(copy) if copy.is_a?(Hash)
        copy.save!
        copy
      end
    rescue ActiveRecord::RecordNotUnique => error
      # Only "this learner already has a copy" is a skip; anything else is a real failure.
      student_id = copy.is_a?(Hash) ? copy[:student_id] : copy.student_id
      raise unless CohortFile.exists?(cohort_id: source.cohort_id, student_id: student_id, source_file_id: source.id)

      Rails.logger.info("[CohortFileCopy] concurrent_copy_skipped source_id=#{source.id} student_id=#{student_id} #{error.class}")
      nil
    end

    def remove_copied_object(key)
      return unless S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_copy_rolled_back") == :failed

      Rails.logger.error("[CohortFileCopy] copy_cleanup_queued_for_retry")
    end
  end
end
