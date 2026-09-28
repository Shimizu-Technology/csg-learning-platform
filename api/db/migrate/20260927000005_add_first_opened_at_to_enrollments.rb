class AddFirstOpenedAtToEnrollments < ActiveRecord::Migration[8.1]
  def change
    add_column :enrollments, :first_opened_at, :datetime
  end
end
