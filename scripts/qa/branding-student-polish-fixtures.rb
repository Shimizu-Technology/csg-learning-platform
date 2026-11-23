# Synthetic fixtures for item 5 (branding, unread badge, private meeting timezones, self-paced welcome, touch targets).
require_relative "boot"

school_zone = Rails.application.config.x.school.time_zone
opposite_zone = school_zone == "Pacific/Guam" ? "America/Chicago" : "Pacific/Guam"

admin = User.find(1)
instructor = User.find(2)
student = User.find(3)
new_student = User.find(7)
program = Cohort.find_by!(name: "QA Program")
self_paced = Cohort.find_by!(name: "QA Self paced")

# Ensure v2 experience is on for QA Program and QA Self paced so Today, My work, and FirstRunWelcome render.
program.update!(settings: (program.settings || {}).merge("features" => (program.settings&.dig("features") || {}).merge("student_experience_v2" => true, "private_meetings" => true, "announcements" => true)))
self_paced.update!(settings: (self_paced.settings || {}).merge("features" => (self_paced.settings&.dig("features") || {}).merge("student_experience_v2" => true, "announcements" => true)), learner_pace_weeks: [])

# Reset Persona 7 first-run welcome state and seed a submission window on QA Self paced.
p7_enrollment = Enrollment.find_by!(user: new_student, cohort: self_paced)
p7_enrollment.update!(start_here_dismissed_at: nil)
self_paced.cohort_module_submission_windows.destroy_all
sp_mod = self_paced.curriculum.modules.order(:position).first!
window_close = (Time.current + 14.days).change(hour: 23, min: 59, sec: 0)
self_paced.cohort_module_submission_windows.create!(curriculum_module: sp_mod, week_number: 1, submissions_close_at: window_close)

# Seed a deterministic set of 2 unread notifications for Persona 3 (distinct notifiables).
student.notifications.where(title: [ "QA Unread Notice 1", "QA Unread Notice 2" ]).delete_all
student.notifications.where(read_at: nil).update_all(read_at: Time.current)
announcements = (1..2).map do |i|
  Announcement.find_or_create_by!(cohort: program, title: "QA Unread Notice #{i}") do |a|
    a.author = admin
    a.body = "Synthetic notice #{i} for phone unread badge QA."
    a.audience = :cohort
    a.status = :published
  end
end
announcements.each_with_index do |announcement, i|
  Notification.create!(
    user: student,
    actor: admin,
    notifiable: announcement,
    notification_type: :announcement,
    title: "QA Unread Notice #{i + 1}",
    body: "Synthetic notice #{i + 1} for phone unread badge QA.",
    path: "/announcements?cohort_id=#{program.id}"
  )
end

# Create/reset an opposite-timezone cohort with private meetings for Persona 3.
chicago = opposite_zone == "America/Chicago"
opp_name = chicago ? "QA Chicago Meetings" : "QA Guam Meetings"
tz = Time.find_zone!(opposite_zone)
target_date = Time.current.in_time_zone(tz).to_date + 3
# The same instant lands in a different course week if grouped in the school zone.
# Chicago: last night of week 1, already week 2 in Guam. Guam: first morning
# of week 2, still week 1 in Chicago.
expected_week = chicago ? 1 : 2
course_start = target_date - (chicago ? 6 : 7)
opp_cohort = Cohort.find_by(name: opp_name)
unless opp_cohort
  opp_cohort = Cohort.create!(
    name: opp_name,
    curriculum: program.curriculum,
    start_date: course_start,
    status: :active,
    cohort_type: :bootcamp,
    course_delivery: "program",
    settings: { "features" => { "student_experience_v2" => true, "private_meetings" => true, "announcements" => true } }
  )
  opp_cohort.instructors << instructor
end

opp_cohort.update!(start_date: course_start)

opp_enrollment = Enrollment.find_or_create_by!(user: student, cohort: opp_cohort) do |e|
  e.status = :active
end
opp_enrollment.update!(status: :active)

config = PrivateMeetingConfig.find_or_initialize_by(cohort: opp_cohort)
config.update!(
  instructor: admin,
  enabled: true,
  weeks: 4,
  duration_minutes: 60,
  timezone: opposite_zone,
  reschedule_cutoff_hours: 1,
  max_student_changes: 1
)
PrivateMeetingBookingEvent.where(private_meeting_booking_id: PrivateMeetingBooking.where(cohort: opp_cohort).select(:id)).delete_all
PrivateMeetingBooking.where(cohort: opp_cohort).delete_all
PrivateMeetingSlot.where(private_meeting_config_id: config.id).delete_all

slot_start = tz.local(target_date.year, target_date.month, target_date.day, chicago ? 22 : 0, 30)
publish_date = target_date + 1
publish_start = tz.local(publish_date.year, publish_date.month, publish_date.day, 10)
slot = config.private_meeting_slots.create!(
  instructor: admin,
  starts_at: slot_start,
  ends_at: slot_start + 60.minutes
)

# Also configure a legacy (v2 off) cohort with a submission window to measure Dashboard standalone lesson link.
legacy_cohort = Cohort.find_or_create_by!(name: "QA Legacy Dashboard") do |c|
  c.curriculum = program.curriculum
  c.start_date = Date.current - 7
  c.status = :active
  c.cohort_type = :bootcamp
  c.course_delivery = "program"
  c.settings = { "features" => { "student_experience_v2" => false, "announcements" => true } }
end
legacy_cohort.update!(settings: (legacy_cohort.settings || {}).merge("features" => (legacy_cohort.settings&.dig("features") || {}).merge("student_experience_v2" => false, "announcements" => true)))
legacy_enrollment = Enrollment.find_or_create_by!(user: student, cohort: legacy_cohort) { |e| e.status = :active }
legacy_enrollment.assign_cohort_content_defaults!
legacy_cohort.cohort_module_submission_windows.destroy_all
legacy_mod = legacy_cohort.curriculum.modules.order(:position).first!
legacy_cohort.cohort_module_submission_windows.create!(curriculum_module: legacy_mod, week_number: 1, submissions_close_at: window_close)

# Output IDs for Playwright spec.
out = {
  school_zone: school_zone,
  opposite_zone: opposite_zone,
  program_id: program.id,
  self_paced_id: self_paced.id,
  legacy_cohort_id: legacy_cohort.id,
  opp_cohort_id: opp_cohort.id,
  opp_cohort_name: opp_cohort.name,
  slot_id: slot.id,
  slot_week: expected_week,
  slot_starts_at: slot.starts_at.utc.iso8601,
  staff_entry_local: publish_start.strftime("%Y-%m-%dT%H:%M"),
  staff_entry_expected_utc: publish_start.utc.iso8601
}
puts JSON.generate(out)
