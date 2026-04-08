class RestoreUserEmailNotNull < ActiveRecord::Migration[8.1]
  def up
    User.where(clerk_id: nil).update_all("clerk_id = CONCAT('pending_', gen_random_uuid())")
    change_column_null :users, :clerk_id, false
    change_column_null :users, :email, false
  end

  def down
    change_column_null :users, :email, true
    change_column_null :users, :clerk_id, true
  end
end
