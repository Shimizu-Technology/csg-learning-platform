class AddSubmissionWindowWeekCheck < ActiveRecord::Migration[8.1]
  def change
    add_check_constraint :cohort_module_submission_windows,
      "week_number > 0",
      name: "submission_windows_week_number_positive"
  end
end
