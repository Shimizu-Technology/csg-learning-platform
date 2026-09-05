class AddClientMessageIdToMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  INDEX_NAME = "idx_messages_on_author_and_client_message_id"

  def up
    add_column :messages, :client_message_id, :string, limit: 100 unless column_exists?(:messages, :client_message_id)
    # CREATE INDEX CONCURRENTLY can leave an invalid same-named index when it
    # is interrupted. Rebuilding the exact index makes a retry deterministic
    # instead of allowing IF NOT EXISTS to accept a broken definition.
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    add_index :messages,
      [ :author_id, :client_message_id ],
      unique: true,
      where: "client_message_id IS NOT NULL",
      algorithm: :concurrently,
      name: INDEX_NAME
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    remove_column :messages, :client_message_id if column_exists?(:messages, :client_message_id)
  end
end
