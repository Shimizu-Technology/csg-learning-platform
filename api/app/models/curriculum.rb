class Curriculum < ApplicationRecord
  self.table_name = "curricula"

  enum :status, { draft: 0, active: 1, archived: 2 }, validate: true

  has_many :modules, -> { order(:position) }, class_name: "CurriculumModule", dependent: :destroy
  has_many :cohorts, dependent: :restrict_with_error
  has_many :learning_objectives, -> { ordered }, dependent: :destroy
  has_many :rubrics, dependent: :destroy
  has_many :curriculum_resources, dependent: :restrict_with_error
  # Template files each new cohort starts with. Each destroy queues its stored
  # objects in this transaction, after the tree lock below.
  has_many :curriculum_files, dependent: :destroy
  # Set when this curriculum is one cohort's own copy (CurriculumCopyForCohort).
  has_one :cohort_copy, class_name: "CurriculumCopy", foreign_key: :copy_curriculum_id, inverse_of: :copy_curriculum

  # Lock the curriculum, then its whole tree top-down (see
  # CurriculumModule.lock_for_destroy!), before the restrict checks and the
  # modules' own learner-data guards run. Those guards then re-take locks
  # this transaction already holds, so the order never inverts.
  before_destroy -> { lock_tree_for_destroy! }, prepend: true

  validates :name, presence: true
  validate :archive_preserves_live_offerings

  # Lock order for curriculum content. Every transaction that takes more than
  # one of these locks takes them in this order, so two can never each hold
  # a lock the other is waiting for:
  #
  #   0. Hosted video keys' advisory locks, after the storage checks
  #      (S3ObjectCleanup), before any row lock.
  #   1. The curriculum row. Lesson authors take FOR SHARE here, inside the
  #      authorization check (LessonEditAccess, lock: true), so saves on the
  #      same curriculum run side by side. Anything that changes which cohorts
  #      use a curriculum (Cohort#lock_curriculum_for_availability: cohort
  #      create, a cohort's curriculum_id change, status and checkout changes,
  #      which #264's archive guard reads) and anything that restructures it
  #      (LessonMove, reorder_modules!, destroy) takes FOR UPDATE; updating
  #      the row itself (rename, archive) conflicts with FOR SHARE too. Each
  #      waits for authors already past their check, and vice versa.
  #   2. Instructor grant rows (cohort_instructor_assignments), FOR SHARE in
  #      ascending id (LessonEditAccess). Revokes and removals lock only their
  #      own row.
  #   3. Modules, ascending id (LessonMove, LessonDuplicate).
  #   4. Lessons, ascending id (Lesson#with_authoring_lock, LessonMove,
  #      LessonDuplicate).
  #   5. Content blocks, ascending id (ContentBlock lock helpers).
  #
  # mode is "FOR SHARE" for authors and "FOR UPDATE" for membership or
  # structure changes. Raises RecordNotFound when the curriculum is gone.
  def self.lock_for_content!(id, mode = "FOR SHARE")
    where(id: id).lock(mode).pick(:id) || raise(ActiveRecord::RecordNotFound.new("Couldn't find Curriculum with 'id'=#{id}", name, "id", id))
  end

  def reorder_modules!(ids)
    with_lock do
      ordered = modules.to_a
      unless ids.is_a?(Array) && ids.all? { |id| id.is_a?(Integer) } && ids.sort == ordered.map(&:id).sort
        errors.add(:base, "module_ids must contain every module exactly once")
        raise ActiveRecord::RecordInvalid, self
      end
      offset = (ordered.map(&:position).max || 0) + ordered.size + 1
      ordered.each_with_index { |mod, index| mod.update_columns(position: offset + index) }
      ids.each_with_index { |id, index| ordered.find { |mod| mod.id == id }.update!(position: index) }
    end
  end

  def archive_blockers
    cohorts.where(status: [ :upcoming, :active ]).or(cohorts.where(public_checkout_enabled: true)).exists?
  end

  private

  def lock_tree_for_destroy!
    self.class.where(id: id).lock.pluck(:id)
    CurriculumModule.lock_for_destroy!(CurriculumModule.where(curriculum_id: id).pluck(:id))
  end

  def archive_preserves_live_offerings
    return unless will_save_change_to_status? && archived? && archive_blockers

    errors.add(:status, "cannot archive while upcoming or active cohorts or checkout-enabled offerings use this curriculum")
  end
end
