# Live "online" updates for the staff student lists (cohort detail and the
# students page). A student's heartbeat reaches only the people allowed to see
# that student: admins and the instructors assigned to one of the student's
# cohorts. Students have no presence UI, so their subscriptions are rejected.
#
# Streams are evaluated when the subscription starts. A cable token is single
# use, so a reconnect (page load, network change, deploy) re-reads the
# instructor's cohort assignments.
class PresenceChannel < ApplicationCable::Channel
  ADMIN_STREAM = "presence:admins".freeze

  def self.cohort_stream(cohort_id)
    "presence:cohort:#{cohort_id}"
  end

  def subscribed
    user = current_user
    return reject if user.archived? || !user.staff?
    return stream_from(ADMIN_STREAM) if user.admin?

    # Same rule as User#accessible_cohorts for an instructor: assigned cohorts only.
    # An instructor with no assignments stays subscribed but receives nothing.
    user.cohort_instructor_assignments.pluck(:cohort_id).each do |cohort_id|
      stream_from self.class.cohort_stream(cohort_id)
    end
  end
end
