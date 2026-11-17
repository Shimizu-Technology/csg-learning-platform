require_relative "boot"
require "json"
# Synthetic On/Off lessons, a real paused library, and an inactive help author.
result = {}
%w[on off].each do |mode|
  curriculum = Curriculum.create!(name: "QA Reliability #{mode}")
  mod = curriculum.modules.create!(name: "Reliability history", position: 0, schedule_days: "daily")
  lesson = mod.lessons.create!(title: "Reliability practice #{mode}", position: 0, release_day: 0, created_at: 30.days.ago)
  lesson.content_blocks.create!(block_type: :exercise, title: "Practice locally", body: "Try this exercise in your own editor.", filename: "practice.rb", submission_type: :manual_complete, position: 0)
  later = mod.lessons.create!(title: "Later reliability lesson", position: 1, release_day: 20, created_at: 30.days.ago)
  cohort = Cohort.create!(name: "QA Reliability #{mode}", curriculum: curriculum, start_date: 10.days.ago.to_date, status: :active, settings: { "features" => { "student_experience_v2" => mode == "on" } })
  cohort.cohort_instructor_assignments.create!(user_id: 2)
  paused_assignment = nil
  [3, 5].each do |id|
    enrollment = Enrollment.create!(user_id: id, cohort: cohort)
    assignment = enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    paused_assignment = assignment.id if id == 5
    enrollment.update!(status: :paused) if id == 5
  end
  result[mode] = { cohort: cohort.id, lesson: lesson.id, later: later.id, module: mod.id, paused_assignment: paused_assignment, start_date: cohort.start_date.iso8601 }
end
# A refused scheduled update belongs to the removed instructor, not students.
refused_cohort = Cohort.create!(name: "QA Removed teaching assignment", curriculum_id: 1, start_date: 10.days.ago.to_date, status: :active)
assignment = refused_cohort.cohort_instructor_assignments.create!(user_id: 2)
update = Announcement.create!(author_id: 2, cohort: refused_cohort, audience: :cohort, status: :draft, title: "QA refused scheduled update", body: "Private draft words.")
update.update_columns(scheduled_for: 1.hour.ago, scheduled_by_id: 2)
assignment.destroy!
ScheduledAnnouncementPublisher.new.call(now: Time.current)
result["refused"] = { id: update.id, cohort: refused_cohort.id, reason: update.reload.schedule_failure }
# Backdate enrollment participation; asking for help must not refresh it.
e = Enrollment.find_by!(user_id: 4, cohort_id: 1)
e.update_columns(joined_at: 20.days.ago, enrolled_at: 20.days.ago)
HelpRequest.where(student_id: 4, cohort_id: 1).destroy_all
ActivityEvent.where(subject_user_id: 4, cohort_id: 1).delete_all
Submission.where(enrollment: e).delete_all
KnowledgeCheckAttempt.where(enrollment: e).delete_all
Pathname.new(__dir__).join('../../.qa-local/staff-reliability.json').write(JSON.pretty_generate(result))
puts JSON.pretty_generate(result)
