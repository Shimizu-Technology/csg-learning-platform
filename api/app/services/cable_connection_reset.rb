# Action Cable authorizes a stream when the subscription starts, and each
# connection keeps the User it loaded at connect time. After a change to what a
# user may receive (role, archive state, cohort assignments), this closes that
# user's open connections. The clients reconnect with a fresh cable token, the
# connection loads the user again, and every channel re-authorizes.
#
# The message travels on the connection's internal pubsub channel, which the
# async adapter delivers within the one production process (see cable.yml).
class CableConnectionReset
  def self.call(user)
    return if user&.id.blank?

    ActionCable.server.remote_connections.where(current_user: user).disconnect(reconnect: !user.archived?)
  rescue StandardError => e
    Rails.logger.warn("CableConnectionReset: disconnect failed user_id=#{user&.id}: #{e.class}: #{e.message}")
  end
end
