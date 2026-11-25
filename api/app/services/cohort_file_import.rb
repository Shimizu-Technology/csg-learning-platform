# Brings class items into a cohort: the ready template files of its
# curriculum (on cohort creation and "Import from curriculum"), or the ready
# class items of another cohort ("Copy from another cohort"). Private student
# folders are never copied.
#
# Each item is imported at most once per cohort, enforced by the partial
# unique indexes on source_curriculum_file_id and source_cohort_file_id, so
# a retry, a double click or two staff at once only add what is missing. A
# copy of another cohort's item that came from one of this cohort's own
# templates keeps that template too, so it is never imported twice.
#
# A file's bytes are copied in storage to a fresh key first, outside any
# transaction or row lock. The row is then inserted in a short transaction
# that holds the cohort row FOR SHARE (Cohort#destroy takes it FOR UPDATE
# first, so a deletion either waits for the import or the import sees the
# cohort gone) and rechecks that the item is still missing. When the insert
# skips or rolls back, the copied object is deleted or queued for retry.
#
# New items marked auto_copy_to_students then go to every active learner
# (CohortFileCopy).
class CohortFileImport
  Result = Struct.new(:files, :skipped, :auto_copied, keyword_init: true)

  class << self
    def from_curriculum(cohort, actor:)
      sources = cohort.curriculum ? cohort.curriculum.curriculum_files.ready.order(:folder, :title, :id).to_a : []
      run(cohort, sources, :source_curriculum_file_id, actor: actor)
    end

    def from_cohort(cohort, source_cohort, actor:)
      sources = source_cohort.cohort_files.class_files.ready.order(:folder, :title, :id).to_a
      run(cohort, sources, :source_cohort_file_id, actor: actor)
    end

    # A new cohort's starting files. Never raises: a cohort is never left
    # uncreated because storage is missing or failing; anything skipped can
    # be brought in later with "Import from curriculum".
    def seed_new_cohort(cohort, actor:)
      from_curriculum(cohort, actor: actor)
    rescue StandardError => error
      Rails.logger.error("[CohortFileImport] seed_failed cohort_id=#{cohort.id} #{error.class}")
      nil
    end

    private

    def run(cohort, sources, link_column, actor:)
      existing = cohort.cohort_files.class_files.pluck(:source_curriculum_file_id, :source_cohort_file_id)
      have = { source_curriculum_file_id: existing.map(&:first).compact.to_set, source_cohort_file_id: existing.map(&:last).compact.to_set }
      templates = cohort.curriculum ? cohort.curriculum.curriculum_files.pluck(:id).to_set : Set.new
      files = []
      skipped = 0
      sources.each do |source|
        links = { link_column => source.id }
        template_id = source.try(:source_curriculum_file_id)
        links[:source_curriculum_file_id] = template_id if link_column == :source_cohort_file_id && templates.include?(template_id)
        file = import_one(cohort, source, links, actor) unless links.any? { |column, id| have.fetch(column).include?(id) }
        file ? files << file : skipped += 1
      rescue StandardError => error
        # One item storage can't copy (missing, failing) never stops the rest; it is skipped and can be imported again.
        Rails.logger.error("[CohortFileImport] item_failed cohort_id=#{cohort.id} #{link_column}=#{source.id} #{error.class}")
        skipped += 1
      end
      Result.new(files: files, skipped: skipped, auto_copied: CohortFileCopy.auto_copy_new_items(files, actor: actor))
    end

    # The new class item, or nil when it was already there, storage is
    # unavailable for an upload, or the cohort is gone.
    def import_one(cohort, source, links, actor)
      attributes = links.merge(
        kind: source.kind, student_id: nil, uploaded_by_id: actor&.id || source.uploaded_by_id,
        title: source.title, description: source.description, folder: source.folder, visibility: source.visibility,
        auto_copy_to_students: source.auto_copy_to_students? && !source.staff_only?, ready: true
      )
      if source.link?
        insert(cohort, links, attributes.merge(external_url: source.external_url))
      elsif source.doc?
        insert(cohort, links, attributes.merge(doc_content: source.doc_content.to_s, doc_updated_at: Time.current, doc_updated_by_id: actor&.id))
      else
        import_stored_file(cohort, source, links, attributes)
      end
    end

    def import_stored_file(cohort, source, links, attributes)
      return nil unless S3Service.configured?

      token = SecureRandom.uuid
      key = "cohort_files/cohort_#{cohort.id}/shared/#{token}/#{source.filename}"
      attributes = attributes.merge(
        filename: source.filename, content_type: source.content_type, file_size: source.file_size, s3_key: key,
        upload_key: "cohort_file_uploads/cohort_#{cohort.id}/#{token}/#{source.filename}", upload_expires_at: Time.current
      )
      cohort.cohort_files.new(attributes).validate!
      begin
        S3Service.copy_object(source.s3_key, key)
        file = insert(cohort, links, attributes)
        remove_copied_object(key) unless file
        file
      rescue StandardError
        remove_copied_object(key)
        raise
      end
    end

    def insert(cohort, links, attributes)
      CohortFile.transaction do
        next nil unless Cohort.where(id: cohort.id).lock("FOR SHARE").pick(:id)
        next nil if already_imported?(cohort, links)

        CohortFile.create!(attributes.merge(cohort_id: cohort.id))
      end
    rescue ActiveRecord::RecordNotUnique => error
      # Only "this cohort already has it" is a skip; anything else is a real failure.
      raise unless already_imported?(cohort, links)

      Rails.logger.info("[CohortFileImport] concurrent_import_skipped cohort_id=#{cohort.id} #{error.class}")
      nil
    end

    def already_imported?(cohort, links)
      links.any? { |column, id| CohortFile.exists?(cohort_id: cohort.id, student_id: nil, column => id) }
    end

    def remove_copied_object(key)
      return unless S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_import_rolled_back") == :failed

      Rails.logger.error("[CohortFileImport] import_cleanup_queued_for_retry")
    end
  end
end
