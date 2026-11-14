class AddAgentPostingTokenToMessages < ActiveRecord::Migration[8.1]
  # Production runs through Neon's transaction-mode pooler, where each statement
  # outside a transaction can land on a different session. Lock timeouts are
  # therefore set with SET LOCAL inside short explicit transactions, never with
  # a session-level SET. The concurrent index runs outside any transaction and
  # relies on the server's default lock timeout.
  disable_ddl_transaction!

  INDEX_NAME = "idx_messages_on_agent_posting_token"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column :messages, :agent_posting_token_id, :bigint unless column_exists?(:messages, :agent_posting_token_id)
      add_column :messages, :sent_via_label, :string, limit: 60 unless column_exists?(:messages, :sent_via_label)
      unless foreign_key_exists?(:messages, :agent_posting_tokens)
        add_foreign_key :messages, :agent_posting_tokens, on_delete: :nullify, validate: false
      end
    end
    with_lock_timeout { validate_foreign_key :messages, :agent_posting_tokens }

    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}" unless valid_index?
    unless index_name_exists?(:messages, INDEX_NAME)
      add_index :messages, :agent_posting_token_id,
        where: "agent_posting_token_id IS NOT NULL",
        algorithm: :concurrently,
        name: INDEX_NAME
    end
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    with_lock_timeout do
      remove_foreign_key :messages, :agent_posting_tokens if foreign_key_exists?(:messages, :agent_posting_tokens)
      remove_column :messages, :sent_via_label if column_exists?(:messages, :sent_via_label)
      remove_column :messages, :agent_posting_token_id if column_exists?(:messages, :agent_posting_token_id)
    end
  end

  private

  # One transaction, so SET LOCAL and the DDL run on the same pooled session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end

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
