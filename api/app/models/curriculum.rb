class Curriculum < ApplicationRecord
  self.table_name = "curricula"

  enum :status, { draft: 0, active: 1, archived: 2 }, validate: true

  has_many :modules, -> { order(:position) }, class_name: "CurriculumModule", dependent: :destroy
  has_many :cohorts, dependent: :restrict_with_error
  has_many :learning_objectives, -> { ordered }, dependent: :destroy
  has_many :rubrics, dependent: :destroy
  has_many :curriculum_resources, dependent: :restrict_with_error

  # Lock the curriculum, then its whole tree top-down (see
  # CurriculumModule.lock_for_destroy!), before the restrict checks and the
  # modules' own learner-data guards run. Those guards then re-take locks
  # this transaction already holds, so the order never inverts.
  before_destroy -> { lock_tree_for_destroy! }, prepend: true

  validates :name, presence: true
  validate :archive_preserves_live_offerings

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
