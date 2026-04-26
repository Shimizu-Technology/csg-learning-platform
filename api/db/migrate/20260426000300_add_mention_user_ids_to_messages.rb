class AddMentionUserIdsToMessages < ActiveRecord::Migration[8.1]
  def change
    add_column :messages, :mention_user_ids, :bigint, array: true, default: [], null: false
  end
end
