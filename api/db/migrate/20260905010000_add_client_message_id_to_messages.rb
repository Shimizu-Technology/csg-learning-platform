class AddClientMessageIdToMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_column :messages, :client_message_id, :string, limit: 100
    add_index :messages,
      [ :author_id, :client_message_id ],
      unique: true,
      where: "client_message_id IS NOT NULL",
      algorithm: :concurrently,
      name: "idx_messages_on_author_and_client_message_id"
  end
end
