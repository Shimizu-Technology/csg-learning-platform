class LearningPlanRevision < ApplicationRecord
  belongs_to :learning_plan
  belongs_to :author, class_name: "User"
end
