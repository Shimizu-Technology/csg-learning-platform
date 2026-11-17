class FeatureSwitchChange < ApplicationRecord
  # Every change made in the app names its admin. The column also allows no
  # actor for system changes written by migrations (see
  # 20261118020000_keep_running_cohorts_on_current_student_experience).
  belongs_to :actor, class_name: "User"
  belongs_to :cohort, optional: true
end
