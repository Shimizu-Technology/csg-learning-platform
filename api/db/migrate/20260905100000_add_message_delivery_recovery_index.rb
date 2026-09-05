class AddMessageDeliveryRecoveryIndex < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  INDEX_NAME = "idx_messages_delivery_recovery_due"
  PREDICATE = <<~SQL.squish
    delivery_tracking_requested = TRUE AND (
      notifications_delivered_at IS NULL OR
      broadcasts_delivered_at IS NULL OR
      (parent_message_id IS NOT NULL AND thread_broadcasts_delivered_at IS NULL)
    )
  SQL

  def up
    execute "SET lock_timeout = '5s'"
    return if usable_expected_index?

    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
    add_index :messages,
      [ :delivery_recovery_attempted_at, :id ],
      where: PREDICATE,
      algorithm: :concurrently,
      name: INDEX_NAME
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  def down
    execute "SET lock_timeout = '5s'"
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
  ensure
    execute "SET lock_timeout = DEFAULT"
  end

  private

  def usable_expected_index?
    index = connection.indexes(:messages).find { |candidate| candidate.name == INDEX_NAME }
    return false unless index && index.columns == %w[delivery_recovery_attempted_at id] && !index.unique

    return false unless normalize_predicate(index.where) == normalize_predicate(PREDICATE)

    connection.select_value(<<~SQL.squish) == true
      SELECT index.indisvalid AND index.indisready
      FROM pg_class relation
      JOIN pg_index index ON index.indexrelid = relation.oid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relname = #{connection.quote(INDEX_NAME)}
        AND namespace.nspname = ANY (current_schemas(false))
    SQL
  end

  def normalize_predicate(value)
    predicate = value.to_s.downcase.squish
      .gsub(/\s*\(\s*/, " (")
      .gsub(/\s*\)\s*/, ") ")
      .squish

    loop do
      simplified = predicate.gsub(/\(([^()]*)\)/) do |match|
        inner = Regexp.last_match(1).strip
        inner.match?(/\b(?:and|or)\b/) ? "(#{inner})" : inner
      end
      break if simplified == predicate

      predicate = simplified.squish
    end

    while predicate.start_with?("(") && outer_parentheses_wrap?(predicate)
      predicate = predicate[1...-1].strip
    end
    predicate.gsub(/\(\s+/, "(").gsub(/\s+\)/, ")")
  end

  def outer_parentheses_wrap?(predicate)
    depth = 0
    predicate.each_char.with_index do |character, index|
      depth += 1 if character == "("
      depth -= 1 if character == ")"
      return false if depth.zero? && index < predicate.length - 1
    end
    depth.zero?
  end
end
