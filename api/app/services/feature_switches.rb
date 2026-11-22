class FeatureSwitches
  # `student_experience_v2` is the redesigned student experience (W8): Learn's
  # course outline first, then Today, the lesson page and first run. It defaults
  # on for new cohorts and self-paced courses; cohorts already running when it
  # shipped have an Off override (migration 20261118020000). Web reads it with
  # `useStudentExperience`, mobile with `studentExperienceV2`.
  # Every switch must declare a boolean default here. Existing switches retain
  # their shipped defaults; add future switches as false until rollout is intended.
  DEFAULTS = {
    "private_meetings" => true,
    "office_hours" => true,
    "recordings" => true,
    "class_channels" => true,
    "self_paced_peer_space" => false,
    "knowledge_checks" => true,
    "help_requests" => true,
    "github_sync" => true,
    "github_app" => false,
    "announcements" => true,
    "interventions" => true,
    "learning_plans" => true,
    "student_experience_v2" => true,
    # W9.3 learner reminders: the school switch and an explicit cohort opt-in.
    "learner_nudges" => false,
    "certificates" => false
  }.freeze
  # Switches a cohort only gets by opting in itself, with the school switch on:
  # a cohort that inherits gets Off even when the school default is On.
  COHORT_OPT_IN = %w[github_app self_paced_peer_space learner_nudges certificates].freeze
  KEYS = DEFAULTS.keys.freeze

  # Pass `school:` (from .school) when resolving many cohorts, to read the school setting once.
  def self.for(cohort: nil, school: nil)
    defaults = school || self.school
    overrides = (cohort&.settings&.dig("features") || {}).slice(*KEYS).compact
    resolved = defaults.merge(overrides)
    # Opt-in switches require both school activation and an explicit cohort opt-in.
    COHORT_OPT_IN.each { |key| resolved[key] = defaults[key] == true && overrides[key] == true } if cohort
    resolved
  end

  # A disabled certificate switch is implicit in existing client payloads.
  # The management endpoint still includes the explicit default and override.
  def self.for_client(features)
    features["certificates"] == true ? features : features.except("certificates")
  end

  # Preview/audit callers must not lazily create a settings row.
  def self.school(read_only: false)
    setting = read_only ? SchoolSetting.find_by(id: 1) : SchoolSetting.current
    DEFAULTS.merge((setting&.features || {}).slice(*KEYS))
  end

  def self.validate!(features)
    unless features.is_a?(Hash) && (features.keys - KEYS).empty? && features.values.all? { |v| [ true, false, nil ].include?(v) }
      raise ArgumentError, "Features must contain known switches with on, off, or inherit values"
    end
  end
end
