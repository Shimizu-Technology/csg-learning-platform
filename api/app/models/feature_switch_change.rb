class FeatureSwitchChange < ApplicationRecord
  belongs_to :actor, class_name: "User"
  belongs_to :cohort, optional: true
end
