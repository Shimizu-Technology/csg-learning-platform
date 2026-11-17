# What a staff record page shows for the records that had no page (L-5.2):
# a recording, an office-hour session, a private-meeting booking, a learning
# plan, a channel, a rubric and an activity event. One request per page,
# built for one viewer (GET /api/v1/records/:type/:id/detail).
#
# Staff only. Students, archived accounts, unknown ids and records the viewer
# may not open all get nil, so the controller answers 404 and never confirms
# the record exists. Each page is authorized from its cohort id alone before
# anything else loads (RecordDetail::Base#authorized?), so a record the viewer
# can't open costs at most one query more than one that doesn't exist.
#
# Who sees which cohorts (StaffCohortScope):
# - Admins see every cohort.
# - Instructors see the cohorts they teach. A record in another cohort is a
#   404; a rubric shared with other cohorts names only theirs and counts the
#   rest as a number. Curriculum names go through CurriculumName.
#
# Rows carry names, dates, counts and short labels. A channel's recent
# messages are shown only to staff who can open the channel, and a sender the
# viewer has blocked (or who blocked them) reads "Message hidden". No page
# carries direct-message text.
class RecordDetail
  PAGES = {
    "recording" => "RecordingPage",
    "office_hour" => "OfficeHourPage",
    "private_meeting" => "PrivateMeetingPage",
    "learning_plan" => "LearningPlanPage",
    "channel" => "ChannelPage",
    "rubric" => "RubricPage",
    "activity_event" => "ActivityEventPage"
  }.freeze
  TYPES = PAGES.keys.freeze

  def self.for(viewer:, type:, id:, now: Time.current)
    return nil if viewer.nil? || viewer.archived? || !viewer.staff?

    page = PAGES[type.to_s]
    number = Integer(id.to_s, 10, exception: false)
    return nil unless page && number&.positive?

    const_get(page).new(viewer: viewer, id: number, now: now).call
  end
end
