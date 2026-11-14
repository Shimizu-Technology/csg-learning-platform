class CreateAgentPostingTokens < ActiveRecord::Migration[8.1]
  def change
    create_table :agent_posting_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false, limit: 60
      t.string :token_digest, null: false
      t.string :scope, null: false, default: "messages:write", limit: 40
      t.datetime :expires_at
      t.datetime :last_used_at
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :agent_posting_tokens, :token_digest, unique: true
    add_check_constraint :agent_posting_tokens, "scope = 'messages:write'", name: "agent_posting_tokens_scope_valid"
  end
end
