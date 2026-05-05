class PresenceBroadcastService
  def self.user_seen(user)
    ActionCable.server.broadcast(
      "presence:staff",
      {
        event: "presence.updated",
        user_id: user.id,
        last_seen_at: user.last_seen_at
      }
    )
  rescue StandardError => e
    Rails.logger.warn("PresenceBroadcastService: broadcast failed: #{e.class}: #{e.message}")
  end
end
