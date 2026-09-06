class AddWebPushNotificationsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :web_push_notifications_enabled, :boolean, null: false, default: true
  end
end
