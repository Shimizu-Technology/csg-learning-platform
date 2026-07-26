class AddLearningStateResetAtToEnrollments < ActiveRecord::Migration[8.1]
  def change
    add_column :enrollments, :learning_state_reset_at, :datetime
  end
end
