require_relative "boot"
root = File.expand_path("../..", __dir__)
source = JSON.parse(File.read(File.join(root, ".qa-local/authoring-clone-source.json")))
results = File.readlines(File.join(root, ".qa-local/authoring-clone-results.jsonl")).map { |line| JSON.parse(line) }
raise "Expected four browser dimensions" unless results.size == 4
cohort = Cohort.find(1)
raise "Original cohort changed" unless cohort.attributes.as_json == source.fetch("cohort")
raise "Learner rows changed" unless [ Enrollment.count, Progress.count, Submission.count ] == source.values_at("enrollments", "progress", "submissions")
results.each do |result|
  copy = Cohort.find(result.fetch("cohortId"))
  days = (copy.start_date - cohort.start_date).to_i
  raise "Bad cohort" unless copy.status == "upcoming" && copy.enrollments.empty? && !copy.public_checkout_enabled
  raise "Bad switches" unless copy.settings["features"] == cohort.settings["features"] && !FeatureSwitches.for(cohort: copy)["recordings"]
  raise "Schedule shape" unless copy.cohort_module_schedules.pluck(:start_date).sort == cohort.cohort_module_schedules.pluck(:start_date).map { |date| date + days }.sort
  raise "Submission window shape" unless copy.cohort_module_submission_windows.pluck(:submissions_close_at).sort == cohort.cohort_module_submission_windows.pluck(:submissions_close_at).map { |time| time.advance(days: days) }.sort
  raise "Meeting config" unless copy.private_meeting_config.attributes.except("id", "cohort_id", "created_at", "updated_at") == cohort.private_meeting_config.attributes.except("id", "cohort_id", "created_at", "updated_at")
  raise "Office hour shape" unless copy.office_hours.pluck(:starts_at).sort == cohort.office_hours.pluck(:starts_at).map { |time| time.advance(days: days) }.sort
  raise "Draft visibility" unless Curriculum.find(result.fetch("curriculumId")).draft?
  raise "Curriculum choice" unless result.fetch("cloneCurriculum") ? (copy.curriculum_id != cohort.curriculum_id && copy.curriculum.draft?) : copy.curriculum_id == cohort.curriculum_id
  raise "Activity copied" unless copy.course_purchases.empty? && copy.announcements.empty? && copy.recordings.empty? && copy.direct_conversations.empty?
end
puts "Verified #{results.size} browser-created cohorts, date shapes, switches, drafts and unchanged source/learner rows"
