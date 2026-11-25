# A template file on a curriculum: an upload, a link or a Learn Doc that every
# cohort on the curriculum starts with. Cohorts get their own class copy
# (CohortFileImport), so editing or deleting a template never changes a
# cohort's files. Uploads use the same two-phase S3 flow and checks as
# CohortFile; links and docs need no storage. A template marked
# `auto_copy_to_students` also lands in each learner's own folder.
class CurriculumFile < ApplicationRecord
  belongs_to :curriculum
  belongs_to :uploaded_by, class_name: "User", optional: true
  belongs_to :doc_updated_by, class_name: "User", optional: true
  # Cohort copies keep their content when a template goes (the foreign key nulls the link).
  has_many :cohort_imports, class_name: "CohortFile", foreign_key: :source_curriculum_file_id, inverse_of: :source_curriculum_file

  scope :ready, -> { where(ready: true) }

  include CabinetItem
  # Locks the row, then queues both stored keys in the deleting transaction;
  # the objects are removed after it commits (see CohortFile).
  before_destroy :queue_stored_objects, prepend: true
  after_destroy_commit :delete_stored_objects

  # Same as CohortFile.purge_expired_pending!: an expired pending upload can
  # never be published, so it is destroyed under the lock `complete` takes.
  def self.purge_expired_pending!(scope = all, now: Time.current, limit: 50)
    scope.where(ready: false).where(upload_expires_at: ...now).limit(limit).pluck(:id).each do |id|
      file = find_by(id: id)
      next unless file

      file.with_lock do
        next if file.ready? || file.upload_expires_at >= now

        file.destroy!
      end
    rescue ActiveRecord::RecordNotFound
      next
    end
  end

  def stored_keys
    [ upload_key, s3_key ].compact_blank.uniq
  end

  # Saves a doc edit and advances `doc_version`. Templates keep no revision
  # history: cohorts get their own copy, which has one.
  def save_doc!(content:, editor:, title: nil, now: Time.current)
    if title.to_s.include?("\0")
      errors.add(:title, "cannot contain null characters")
      raise ActiveRecord::RecordInvalid, self
    end
    title = title.to_s.squish.presence
    return false if content.to_s == doc_content.to_s && (title.nil? || title == self.title)

    assign_attributes(doc_content: content.to_s, doc_updated_at: now, doc_updated_by: editor, doc_version: doc_version + 1)
    self.title = title if title
    save!
    true
  end

  def template_json(can_manage: false)
    mode = preview_mode
    {
      id: id, curriculum_id: curriculum_id, kind: kind, folder: folder, visibility: visibility,
      title: title, description: description, auto_copy_to_students: auto_copy_to_students?,
      filename: filename, content_type: content_type, file_size: file_size,
      external_url: external_url, link_provider: link_provider,
      previewable: CohortFile.previewable_mode?(mode), preview_mode: mode,
      ready: ready?, ready_at: ready_at&.iso8601, created_at: created_at.iso8601,
      uploaded_by_name: uploaded_by&.full_name,
      doc_version: doc? ? doc_version : nil, doc_updated_at: doc? ? (doc_updated_at || created_at).iso8601(6) : nil,
      doc_updated_by_name: doc? ? doc_updated_by&.full_name : nil,
      can_manage: can_manage
    }
  end

  private

  def queue_stored_objects
    locked = self.class.lock.find_by(id: id)
    @stored_keys_to_delete = (locked || self).stored_keys
    PendingS3Deletion.enqueue_all!(@stored_keys_to_delete, reason: "curriculum_file_destroyed")
  end

  def delete_stored_objects
    PendingS3Deletion.attempt_now!(Array(@stored_keys_to_delete))
  end
end
