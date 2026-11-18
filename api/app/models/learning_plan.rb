class LearningPlan < ApplicationRecord
  SNAPSHOT_FIELDS = %w[active title description target_date next_check_in_on milestones lesson_overrides].freeze
  # "staff" plans are written in the plan editor; "learner_pace" plans are
  # generated from a chosen pace (LearnerPace, W9.1). Saving in the editor
  # makes a plan a staff plan.
  SOURCES = %w[staff learner_pace].freeze

  belongs_to :enrollment
  has_many :revisions, class_name: "LearningPlanRevision", dependent: :destroy

  validates :enrollment_id, uniqueness: true
  validates :title, presence: true, length: { maximum: 160 }
  validates :description, length: { maximum: 2_000 }, allow_blank: true
  validates :active, inclusion: { in: [ true, false ] }
  validates :source, inclusion: { in: SOURCES }
  validates :pace_weeks, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validate :validate_scope
  validate :validate_dates

  def required?(lesson)
    return lesson.required? unless active?

    override = lesson_overrides.find { |item| item["lesson_id"] == lesson.id }
    override ? override["required"] : lesson.required?
  end

  def learner_pace? = source == "learner_pace"

  # A pace plan's revisions also record the pace, so history reads
  # "4 weeks, then 6 weeks". Staff plans keep the original shape.
  def snapshot
    fields = attributes.slice(*SNAPSHOT_FIELDS)
    learner_pace? ? fields.merge("source" => source, "pace_weeks" => pace_weeks) : fields
  end

  private

  def validate_dates
    %w[target_date next_check_in_on].each do |field|
      value = public_send("#{field}_before_type_cast")
      next if value.blank? || value.is_a?(Date)

      errors.add(field, "must be a valid date") unless parse_date(value)
    end
  end

  def validate_scope
    return unless enrollment

    unless milestones.is_a?(Array) && milestones.size <= 50 && lesson_overrides.is_a?(Array) && lesson_overrides.size <= 500
      errors.add(:base, "Use up to 50 milestones and 500 lesson exceptions")
      return
    end
    content = AssignedLearningContent.new(enrollment)
    assigned_ids = content.modules.flat_map { |mod| content.lessons_for(mod).map(&:id) }
    seen_lessons = []
    dates = []
    milestones.each do |item|
      unless item.is_a?(Hash) && item["title"].is_a?(String) && item["title"].strip.present? && item["title"].length <= 160 &&
          item["lesson_ids"].is_a?(Array) && item["lesson_ids"].any? && item["lesson_ids"].all? { |id| id.is_a?(Integer) && (!active? || assigned_ids.include?(id)) }
        errors.add(:milestones, "need a title, target date, and lessons currently assigned to this student")
        next
      end
      date = parse_date(item["due_on"])
      errors.add(:milestones, "need valid target dates") unless date
      dates << date if date
      seen_lessons.concat(item["lesson_ids"])
    end
    errors.add(:milestones, "must list each lesson only once") if seen_lessons.uniq.size != seen_lessons.size
    errors.add(:milestones, "must be in target-date order") unless dates == dates.sort
    errors.add(:target_date, "must be on or after the last milestone") if target_date && dates.any? { |date| date > target_date }

    override_ids = []
    lesson_overrides.each do |item|
      unless item.is_a?(Hash) && item["lesson_id"].is_a?(Integer) && (!active? || assigned_ids.include?(item["lesson_id"])) &&
          [ true, false ].include?(item["required"]) && item["reason"].is_a?(String) && item["reason"].strip.present? && item["reason"].length <= 500
        errors.add(:lesson_overrides, "need an assigned lesson, required or optional choice, and a reason (up to 500 characters)")
        next
      end
      override_ids << item["lesson_id"]
    end
    errors.add(:lesson_overrides, "must list each lesson only once") if override_ids.uniq.size != override_ids.size
  end

  def parse_date(value)
    return unless value.is_a?(String) && value.match?(/\A\d{4}-\d{2}-\d{2}\z/)

    Date.iso8601(value)
  rescue Date::Error
    nil
  end
end
