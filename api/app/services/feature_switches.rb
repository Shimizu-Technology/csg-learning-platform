class FeatureSwitches
  # `student_experience_v2` is the redesigned student experience (W8): Learn's
  # course outline first, then Today, the lesson page and first run. It defaults
  # on for new cohorts and self-paced courses; cohorts already running when it
  # shipped have an Off override (migration 20261118020000). Web reads it with
  # `useStudentExperience`, mobile with `studentExperienceV2`.
  KEYS = %w[private_meetings office_hours recordings class_channels knowledge_checks help_requests github_sync announcements interventions learning_plans student_experience_v2].freeze
  DEFAULTS = KEYS.index_with(true).freeze

  # Pass `school:` (from .school) when resolving many cohorts, to read the school setting once.
  def self.for(cohort: nil, school: nil)
    (school || self.school).merge((cohort&.settings&.dig("features") || {}).slice(*KEYS).compact)
  end

  def self.school
    DEFAULTS.merge(SchoolSetting.current.features.slice(*KEYS))
  end

  def self.validate!(features)
    unless features.is_a?(Hash) && (features.keys - KEYS).empty? && features.values.all? { |v| [ true, false, nil ].include?(v) }
      raise ArgumentError, "Features must contain known switches with on, off, or inherit values"
    end
  end
end
