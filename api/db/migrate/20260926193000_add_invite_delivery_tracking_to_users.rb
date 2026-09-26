class AddInviteDeliveryTrackingToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :invite_delivery_status, :string, null: false, default: "not_sent"
    add_column :users, :invite_sent_at, :datetime
    add_column :users, :invite_last_error, :text
    add_index :users, :invite_delivery_status

    execute <<~SQL.squish
      UPDATE users
      SET invite_delivery_status = CASE
        WHEN clerk_id LIKE 'pending_%' THEN 'sent'
        ELSE 'accepted'
      END
    SQL
  end

  def down
    remove_index :users, :invite_delivery_status
    remove_column :users, :invite_last_error
    remove_column :users, :invite_sent_at
    remove_column :users, :invite_delivery_status
  end
end
