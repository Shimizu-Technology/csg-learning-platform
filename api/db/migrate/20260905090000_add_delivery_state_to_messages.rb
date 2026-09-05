class AddDeliveryStateToMessages < ActiveRecord::Migration[8.1]
  COLUMNS = {
    delivery_push_requested: [ :boolean, { null: false, default: true } ],
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

    # Rows committed before delivery tracking shipped were already handled by
    # the legacy synchronous path. Marking them complete prevents the recovery
    # sweep from replaying historical notifications and broadcasts.
    timestamp = connection.quote(Time.current)
    execute <<~SQL.squish
      UPDATE messages
      SET notifications_delivered_at = #{timestamp},
          broadcasts_delivered_at = #{timestamp},
          thread_broadcasts_delivered_at = #{timestamp}
    SQL
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    COLUMNS.keys.reverse_each { |name| remove_column :messages, name }
  end
end
