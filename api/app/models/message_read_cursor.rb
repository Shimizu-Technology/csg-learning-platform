module MessageReadCursor
  def self.advances?(cursor, read_at, message)
    return true unless cursor.last_read_at
    return true if cursor.last_read_at < read_at

    cursor.last_read_at == read_at && message && cursor.last_read_message_id && cursor.last_read_message_id < message.id
  end

  def self.after(scope, cursor)
    return scope unless cursor&.last_read_at

    if cursor.last_read_message_id
      scope.where("messages.created_at > :at OR (messages.created_at = :at AND messages.id > :id)", at: cursor.last_read_at, id: cursor.last_read_message_id)
    else
      scope.where("messages.created_at > ?", cursor.last_read_at)
    end
  end

  # Same boundary for aggregate/index queries with an already-joined cursor.
  # Callers supply a fixed table alias, never request input.
  def self.after_joined(scope, table)
    raise ArgumentError, "unsupported read cursor table" unless %w[current_members message_read_states].include?(table)

    scope.where("#{table}.last_read_at IS NULL OR messages.created_at > #{table}.last_read_at OR (#{table}.last_read_message_id IS NOT NULL AND messages.created_at = #{table}.last_read_at AND messages.id > #{table}.last_read_message_id)")
  end

  def self.through(scope, cursor)
    return scope.none unless cursor&.last_read_at

    if cursor.last_read_message_id
      scope.where("messages.created_at < :at OR (messages.created_at = :at AND messages.id <= :id)", at: cursor.last_read_at, id: cursor.last_read_message_id)
    else
      scope.where("messages.created_at <= ?", cursor.last_read_at)
    end
  end

  def self.seen?(cursor, message)
    return false unless cursor&.last_read_at

    message.created_at < cursor.last_read_at ||
      (message.created_at == cursor.last_read_at && (cursor.last_read_message_id.nil? || message.id <= cursor.last_read_message_id))
  end
end
