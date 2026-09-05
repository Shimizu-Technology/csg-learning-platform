class AddDeliveryStateToMessages < ActiveRecord::Migration[8.1]
  COLUMNS = {
    delivery_tracking_requested: [ :boolean, { null: false, default: false } ],
    delivery_push_requested: [ :boolean, { null: false, default: true } ],
    # Epoch is the sentinel for never-attempted work. Keep it non-null because
    # the ascending recovery queue must place untouched messages first.
    delivery_recovery_attempted_at: [ :datetime, { null: false, default: Time.utc(1970, 1, 1) } ],
    web_push_attempted_notification_ids: [ :jsonb, { null: false, default: [] } ],
    expo_push_attempted_notification_ids: [ :jsonb, { null: false, default: [] } ],
    notifications_delivery_claim: [ :string, { limit: 36 } ],
    notifications_delivery_started_at: [ :datetime, {} ],
    notifications_delivered_at: [ :datetime, {} ],
    broadcast_recipient_ids: [ :jsonb, { null: false, default: [] } ],
    broadcast_delivery_claim: [ :string, { limit: 36 } ],
    broadcast_delivery_started_at: [ :datetime, {} ],
    broadcasts_delivered_at: [ :datetime, {} ],
    thread_broadcast_recipient_ids: [ :jsonb, { null: false, default: [] } ],
    thread_broadcast_delivery_claim: [ :string, { limit: 36 } ],
    thread_broadcast_delivery_started_at: [ :datetime, {} ],
    thread_broadcasts_delivered_at: [ :datetime, {} ]
  }.freeze

  def up
    execute "SET LOCAL lock_timeout = '5s'"
    COLUMNS.each { |name, (type, options)| add_column :messages, name, type, **options }
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    COLUMNS.keys.reverse_each { |name| remove_column :messages, name }
  end
end
