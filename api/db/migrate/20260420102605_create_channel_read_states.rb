class CreateChannelReadStates < ActiveRecord::Migration[8.1]
  def change
    create_table :channel_read_states do |t|
      t.references :user, null: false, foreign_key: true
      t.references :channel, null: false, foreign_key: true
      t.references :last_read_message, null: true, foreign_key: { to_table: :messages }
      t.datetime :last_read_at

      t.timestamps
    end

    add_index :channel_read_states, [ :user_id, :channel_id ], unique: true
  end
end
