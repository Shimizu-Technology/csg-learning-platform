class RestoreUserEmailNotNull < ActiveRecord::Migration[8.1]
  def change
    change_column_null :users, :email, false
    change_column_null :users, :clerk_id, false
  end
end
