class AddClientMessageIdToMessages < ActiveRecord::Migration[8.1]
  def change
    add_column :messages, :client_message_id, :string
    add_index :messages,
      [ :author_id, :client_message_id ],
      unique: true,
      where: "client_message_id IS NOT NULL",
      name: "idx_messages_on_author_and_client_message_id"
  end
end
