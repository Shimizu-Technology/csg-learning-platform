# What a staff record page shows for the records that had no page (L-5.2):
# a recording, an office-hour session, a private-meeting booking, a learning
# plan, a channel, a rubric, an activity event, a return plan (stored as a
# recovery plan), a community report and a course offering's purchases. One
# request per page, built for one viewer (GET /api/v1/records/:type/:id/detail).
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
# - A community report and an offering's purchases are admin-only, as Safety
#   and the offering settings are; instructors get the 404.
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
    "activity_event" => "ActivityEventPage",
    "recovery_plan" => "RecoveryPlanPage",
    "content_report" => "ContentReportPage",
    "offering" => "OfferingPage"
  }.freeze
  TYPES = PAGES.keys.freeze
  MAX_ID = 9_223_372_036_854_775_807

  # `watchers_after` continues a recording's watcher list after that watch
  # row (the previous response's `watchers_next_after`); `purchases_before`
  # continues an offering's purchases before that purchase. Anything that
  # isn't a positive id starts from the beginning.
  def self.for(viewer:, type:, id:, watchers_after: nil, purchases_before: nil, now: Time.current)
    return nil if viewer.nil? || viewer.archived? || !viewer.staff?

    klass = PAGES[type.to_s]
    number = Integer(id.to_s, 10, exception: false)
    return nil unless klass && number&.positive?

    const_get(klass).new(viewer: viewer, id: number, now: now, after: cursor(watchers_after), before: cursor(purchases_before)).call
  end

  def self.cursor(value)
    number = Integer(value.to_s, 10, exception: false) if value.to_s.match?(/\A[1-9]\d{0,18}\z/)
    number if number && number <= MAX_ID
  end
  private_class_method :cursor
end
