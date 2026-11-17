# Batch-loaded by the switcher. These are visibility facts, not progress counts.
# Match the resource and recording endpoints, including paused read boundaries
# and legacy links already replaced by first-class recordings.
class StudentFeatureAvailability
  def self.for(enrollment)
    cohort = enrollment.cohort
    features = FeatureSwitches.for(cohort: cohort)
    recordings = cohort.recordings.to_a
    migrated = recordings.filter_map(&:legacy_key).to_set
    legacy = Array(cohort.settings&.fetch("recordings", nil)).each_with_index.any? do |item, index|
      !migrated.include?("settings-#{index + 1}") && cohort.content_link_available_for_read?(item, enrollment, date_key: "date")
    end
    {
      recordings: features["recordings"] == true && (legacy || recordings.any? { |item| enrollment.recording_available_for_read?(item) }),
      resources: cohort.class_resources_for_read(enrollment).any? || cohort.curriculum.curriculum_resources.any? { |item| enrollment.resource_available_for_read?(item) }
    }
  end
end
