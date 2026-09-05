class AddDeliveryStateToMessages < ActiveRecord::Migration[8.1]
  def change
    reversible do |direction|
      direction.up { execute "SET LOCAL lock_timeout = '5s'" }
      direction.down { execute "SET LOCAL lock_timeout = '5s'" }
    end
    add_column :messages, :delivery_push_requested, :boolean, null: false, default: true
    add_column :messages, :notifications_delivery_claim, :string, limit: 36
    add_column :messages, :notifications_delivery_started_at, :datetime
    add_column :messages, :notifications_delivered_at, :datetime
    add_column :messages, :broadcast_recipient_ids, :jsonb, null: false, default: []
    add_column :messages, :broadcast_delivery_claim, :string, limit: 36
    add_column :messages, :broadcast_delivery_started_at, :datetime
    add_column :messages, :broadcasts_delivered_at, :datetime
    add_column :messages, :thread_broadcast_recipient_ids, :jsonb, null: false, default: []
    add_column :messages, :thread_broadcast_delivery_claim, :string, limit: 36
    add_column :messages, :thread_broadcast_delivery_started_at, :datetime
    add_column :messages, :thread_broadcasts_delivered_at, :datetime
  end
end
