class CreateHomeBaseTokens < ActiveRecord::Migration[8.1]
  def change
    create_table :home_base_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false
      t.datetime :last_used_at
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :home_base_tokens, :token_digest, unique: true
  end
end
