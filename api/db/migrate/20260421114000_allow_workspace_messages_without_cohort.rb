class AllowWorkspaceMessagesWithoutCohort < ActiveRecord::Migration[8.0]
  def change
    change_column_null :channels, :cohort_id, true
    change_column_null :direct_conversations, :cohort_id, true
  end
end
