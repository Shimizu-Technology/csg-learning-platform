class AddSupportInstructorToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_reference :cohorts, :support_instructor, foreign_key: { to_table: :users }
  end
end
