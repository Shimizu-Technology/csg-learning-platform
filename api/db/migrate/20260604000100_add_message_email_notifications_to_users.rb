class AddMessageEmailNotificationsToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :message_email_notifications_enabled, :boolean, null: false, default: false

    execute <<~SQL.squish
      UPDATE users
      SET message_email_notifications_enabled = TRUE
      WHERE id IN (
        SELECT DISTINCT user_id
        FROM push_subscriptions
        WHERE failed_at IS NULL
      )
    SQL
  end

  def down
    remove_column :users, :message_email_notifications_enabled
  end
end
