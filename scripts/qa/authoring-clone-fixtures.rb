require_relative "boot"
source = Cohort.find(1)
source.update!(start_date: Date.new(2026, 10, 27), settings: source.settings.merge("features" => { "recordings" => nil, "help_requests" => false, "office_hours" => true }))
SchoolSetting.current.update!(features: { "recordings" => false })
source.cohort_module_schedules.create!(module_id: source.curriculum.modules.first.id, start_date: Date.new(2026, 11, 9))
source.cohort_module_schedules.create!(module_id: source.curriculum.modules.second.id, start_date: Date.new(2026, 11, 30))
source.office_hours.update_all(starts_at: Time.utc(2026, 10, 29, 5), ends_at: Time.utc(2026, 10, 29, 6))
source.cohort_module_submission_windows.create!(module_id: source.curriculum.modules.first.id, week_number: 1, submissions_close_at: source.start_date.in_time_zone + 10.days)
source.create_private_meeting_config!(instructor: User.find(1), weeks: 3)
File.write(File.expand_path("../../.qa-local/authoring-clone-source.json", __dir__), {
  cohort: source.attributes, schedules: source.cohort_module_schedules.map(&:attributes),
  windows: source.cohort_module_submission_windows.map(&:attributes), office_hours: source.office_hours.map(&:attributes),
  meeting: source.private_meeting_config.attributes, enrollments: Enrollment.count, progress: Progress.count, submissions: Submission.count
}.to_json)
puts "Authoring clone fixtures ready"
