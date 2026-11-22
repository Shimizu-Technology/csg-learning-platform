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
    # X-6.8 reliable Redo GitHub issues: durable outbox scoped by enrollment and binding.
    "github_issue_delivery_v2" => false,
    # X-6.4 / AS-11 pure grade suggestions from verified exercise check policies.
    "github_grade_suggestions" => false,
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
  COHORT_OPT_IN = %w[github_app github_issue_delivery_v2 github_grade_suggestions self_paced_peer_space learner_nudges certificates].freeze
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

  def self.enabled?(key, cohort: nil, school: nil)
    self.for(cohort: cohort, school: school)[key.to_s] == true
  end

  # Server-only switches never appear in learner/client payloads (session, dashboard,
  # cohorts), even when enabled at the school or cohort level. Admin feature_settings
  # endpoints read FeatureSwitches.for directly and still expose them for management.
  SERVER_ONLY = %w[github_issue_delivery_v2 github_grade_suggestions].freeze

  # Disabled opt-in switches added after the baseline stay implicit in existing
  # client payloads. The management endpoint still includes explicit defaults and overrides.
  IMPLICIT_OFF_FOR_CLIENT = %w[certificates].freeze

  def self.for_client(features)
    hidden = SERVER_ONLY + IMPLICIT_OFF_FOR_CLIENT.reject { |key| features[key] == true }
    hidden.empty? ? features : features.except(*hidden)
  end

  # Preview/audit callers must not lazily create a settings row.
  def self.school(read_only: false)
    setting = if read_only
      if SchoolSetting::RequestCache.enabled
        SchoolSetting::RequestCache.school_setting || SchoolSetting.find_by(id: 1).tap do |found|
          SchoolSetting::RequestCache.school_setting = found if found
        end
      else
        SchoolSetting.find_by(id: 1)
      end
    else
      SchoolSetting.current
    end
    DEFAULTS.merge((setting&.features || {}).slice(*KEYS))
  end

  def self.validate!(features)
    unless features.is_a?(Hash) && (features.keys - KEYS).empty? && features.values.all? { |v| [ true, false, nil ].include?(v) }
      raise ArgumentError, "Features must contain known switches with on, off, or inherit values"
    end
  end
end
