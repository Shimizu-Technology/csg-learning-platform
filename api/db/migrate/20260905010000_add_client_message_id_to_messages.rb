class AddClientMessageIdToMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  INDEX_NAME = "idx_messages_on_author_and_client_message_id"

  def up
    execute "SET lock_timeout = '5s'"
    add_column :messages, :client_message_id, :string, limit: 100 unless column_exists?(:messages, :client_message_id)
    # Concurrent index creation must be allowed to wait out in-flight writes.
    execute "SET lock_timeout = '60s'"
    return if usable_expected_index?

    # CREATE INDEX CONCURRENTLY can leave an invalid same-named index when it
    # is interrupted. Rebuilding the exact index makes a retry deterministic
    # without dropping an already-valid uniqueness guarantee.
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    add_index :messages,
      [ :author_id, :client_message_id ],
      unique: true,
      where: "client_message_id IS NOT NULL",
      algorithm: :concurrently,
      name: INDEX_NAME
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  def down
    execute "SET lock_timeout = '60s'"
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    remove_column :messages, :client_message_id if column_exists?(:messages, :client_message_id)
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  private

  def usable_expected_index?
    index = connection.indexes(:messages).find { |candidate| candidate.name == INDEX_NAME }
    return false unless index && index.unique && index.columns == %w[author_id client_message_id]
    return false unless index.where.to_s.gsub(/[()]/, "").squish == "client_message_id IS NOT NULL"

    ActiveModel::Type::Boolean.new.cast(connection.select_value(<<~SQL.squish))
      SELECT index.indisvalid AND index.indisready
      FROM pg_class relation
      JOIN pg_index index ON index.indexrelid = relation.oid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relname = #{connection.quote(INDEX_NAME)}
        AND namespace.nspname = ANY (current_schemas(false))
    SQL
  end
end
