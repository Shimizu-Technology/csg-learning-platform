class AddHandleToUsers < ActiveRecord::Migration[8.1]
  # Optional @handle people set in Profile so classmates with the same name can
  # tell each other apart without seeing emails (M-13).
  #
  # Production runs through Neon's transaction-mode pooler, where each statement
  # outside a transaction can land on a different session. The lock timeout is
  # therefore set with SET LOCAL inside a short explicit transaction, never with
  # a session-level SET. The unique index is built concurrently outside any
  # transaction; a run interrupted mid-build leaves an invalid index, which the
  # next run drops and rebuilds.
  #
  # Handles are case-insensitive. The model downcases them, and a CHECK keeps
  # every stored handle lowercase so the plain unique index also rejects
  # "Alice" next to "alice" for writes that skip the model. The constraint is
  # added NOT VALID (no table scan under the ACCESS EXCLUSIVE lock) and then
  # validated in its own transaction.
  disable_ddl_transaction!

  INDEX_NAME = "index_users_on_handle"
  CHECK_NAME = "users_handle_lowercase"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column :users, :handle, :string, limit: 30 unless column_exists?(:users, :handle)
    end
    unless check_constraint_exists?(:users, name: CHECK_NAME)
      with_lock_timeout do
        add_check_constraint :users, "handle = lower(handle)", name: CHECK_NAME, validate: false
      end
    end
    with_lock_timeout do
      validate_check_constraint :users, name: CHECK_NAME
    end

    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}" unless valid_index?
    unless index_name_exists?(:users, INDEX_NAME)
      add_index :users, :handle, unique: true, where: "handle IS NOT NULL", algorithm: :concurrently, name: INDEX_NAME
    end
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    with_lock_timeout do
      remove_check_constraint :users, name: CHECK_NAME if check_constraint_exists?(:users, name: CHECK_NAME)
      remove_column :users, :handle if column_exists?(:users, :handle)
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
