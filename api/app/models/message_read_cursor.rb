module MessageReadCursor
  def self.after(scope, cursor)
    return scope unless cursor&.last_read_at

    if cursor.last_read_message_id
      scope.where("messages.created_at > :at OR (messages.created_at = :at AND messages.id > :id)", at: cursor.last_read_at, id: cursor.last_read_message_id)
    else
      scope.where("messages.created_at > ?", cursor.last_read_at)
    end
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
