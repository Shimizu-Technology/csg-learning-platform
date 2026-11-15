class FeatureSwitches
  KEYS = %w[private_meetings office_hours recordings class_channels knowledge_checks help_requests github_sync announcements interventions learning_plans].freeze
  DEFAULTS = KEYS.index_with(true).freeze

  def self.for(cohort: nil)
    DEFAULTS.merge(SchoolSetting.current.features.slice(*KEYS))
      .merge((cohort&.settings&.dig("features") || {}).slice(*KEYS).compact)
  end

  def self.validate!(features)
    unless features.is_a?(Hash) && (features.keys - KEYS).empty? && features.values.all? { |v| [ true, false, nil ].include?(v) }
      raise ArgumentError, "Features must contain known switches with on, off, or inherit values"
    end
  end
end
