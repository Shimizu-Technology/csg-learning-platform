# Sends a heartbeat to the staff who can see this user in a student list:
# instructors of each cohort the user is enrolled in, and admins. Staff cohort
# lists show every enrollment status (including dropped), but never archived
# users, so the same rule applies here. A user with no enrollments appears in
# no staff presence list and is not broadcast.
class PresenceBroadcastService
  def self.user_seen(user)
    streams = streams_for(user)
    return if streams.empty?

    payload = { event: "presence.updated", user_id: user.id, last_seen_at: user.last_seen_at }
    streams.each { |stream| ActionCable.server.broadcast(stream, payload) }
  rescue StandardError => e
    Rails.logger.warn("PresenceBroadcastService: broadcast failed: #{e.class}: #{e.message}")
  end

  def self.streams_for(user)
    return [] if user.archived?

    cohort_ids = user.enrollments.distinct.pluck(:cohort_id)
    return [] if cohort_ids.empty?

    cohort_ids.sort.map { |id| PresenceChannel.cohort_stream(id) } << PresenceChannel::ADMIN_STREAM
  end
end
