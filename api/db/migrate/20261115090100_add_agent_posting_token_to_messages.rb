class AddAgentPostingTokenToMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  INDEX_NAME = "idx_messages_on_agent_posting_token"

  def up
    execute "SET lock_timeout = '5s'"
    add_column :messages, :agent_posting_token_id, :bigint unless column_exists?(:messages, :agent_posting_token_id)
    add_column :messages, :sent_via_label, :string, limit: 60 unless column_exists?(:messages, :sent_via_label)
    unless foreign_key_exists?(:messages, :agent_posting_tokens)
      add_foreign_key :messages, :agent_posting_tokens, on_delete: :nullify, validate: false
    end
    validate_foreign_key :messages, :agent_posting_tokens
    # Concurrent index creation must be allowed to wait out in-flight writes.
    execute "SET lock_timeout = '60s'"
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}" unless valid_index?
    unless index_name_exists?(:messages, INDEX_NAME)
      add_index :messages, :agent_posting_token_id,
        where: "agent_posting_token_id IS NOT NULL",
        algorithm: :concurrently,
        name: INDEX_NAME
    end
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  def down
    execute "SET lock_timeout = '60s'"
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    remove_foreign_key :messages, :agent_posting_tokens if foreign_key_exists?(:messages, :agent_posting_tokens)
    remove_column :messages, :sent_via_label if column_exists?(:messages, :sent_via_label)
    remove_column :messages, :agent_posting_token_id if column_exists?(:messages, :agent_posting_token_id)
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  private

  def valid_index?
    ActiveModel::Type::Boolean.new.cast(connection.select_value(<<~SQL.squish))
      SELECT COALESCE(bool_and(index.indisvalid AND index.indisready), FALSE)
      FROM pg_class relation
      JOIN pg_index index ON index.indexrelid = relation.oid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relname = #{connection.quote(INDEX_NAME)}
        AND namespace.nspname = ANY (current_schemas(false))
    SQL
  end
end
