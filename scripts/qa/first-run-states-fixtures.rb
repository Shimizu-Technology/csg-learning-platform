require_relative "boot"
# Keep all QA data synthetic; no production reads or provider sends.
User.find(3).update!(first_name: "Lance", last_name: "Synthetic")
User.find(7).update!(first_name: "Eli", last_name: "Synthetic")
program = Cohort.find_by!(name: "QA Program")
solo = Cohort.find_by!(name: "QA Self paced")
alumni = Cohort.find_by!(name: "QA Alumni")
Cohort.find_each { |cohort| cohort.update!(settings: (cohort.settings || {}).merge("features" => (cohort.settings&.dig("features") || {}).merge("student_experience_v2" => true))) }
solo.update!(settings: solo.settings.merge("class_resources" => [], "recordings" => []))
program.update!(name: "QA First day program", start_date: LearningCalendar.today, end_date: LearningCalendar.today + 100)
first = program.curriculum.modules.order(:position).first.lessons.order(:release_day, :position).first
first.update!(title: "Orientation")
solo_first = solo.curriculum.modules.order(:position).first.lessons.order(:release_day, :position).first
solo_first.update!(title: "Orientation")
first_day = User.create!(clerk_id: "qa_first_day", email: "first-day@example.invalid", first_name: "Eli", last_name: "Program", role: :student, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
ClerkIdentity.create!(user: first_day, issuer: "https://test.clerk.invalid", clerk_user_id: first_day.clerk_id)
new_program = first_day.enrollments.create!(cohort: program)
new_program.assign_cohort_content_defaults!
redo_block = first.content_blocks.find(&:gradable_work_block?)
Submission.create!(user_id: 4, enrollment: program.enrollments.find_by!(user_id: 4), content_block: redo_block, text: "Synthetic first attempt", grade: "R", feedback: "Explain your approach, then resubmit.", graded_by_id: 2, graded_at: Time.current)
# Persona 4 owns both the active program (waiting work) and Alumni library.
Enrollment.find_or_create_by!(user_id: 4, cohort: alumni) { |row| row.status = :completed }
recording = alumni.recordings.create!(title: "Alumni workshop", source_kind: "external", source_url: "https://example.invalid/alumni-workshop", status: :published, position: 0, recorded_date: LearningCalendar.today)
User.find(8).watch_progresses.create!(recording: recording, last_position_seconds: 30, total_watched_seconds: 30, duration_seconds: 600, last_watched_at: Time.current)
# Active Off fixture matches Lance's program shape without using real learner data.
off = Cohort.create!(name: "QA Cohort 3 Off", curriculum: program.curriculum, start_date: LearningCalendar.today - 90, end_date: Date.new(2026, 12, 19), settings: { "features" => { "student_experience_v2" => false } })
off.instructors << User.find(2)
e = Enrollment.create!(user_id: 3, cohort: off); e.assign_cohort_content_defaults!
first.completion_blocks.each do |block|
  Progress.create!(enrollment: e, user_id: 3, content_block: block, status: :completed, completed_at: Time.current)
  if block.gradable_work_block?
    Submission.create!(enrollment: e, user_id: 3, content_block: block, text: "Synthetic ongoing learner work", grade: "A", graded_by_id: 2, graded_at: Time.current)
  end
end
# Two real public offerings exercise recovery from the query-filtered catalog.
solo.update!(public_checkout_enabled: true, public_title: "QA Self paced", public_description: "Synthetic course for first-run recovery.", public_price_cents: 14900, stripe_price_id: "price_qa_first_run")
catalog_other = Cohort.create!(name: "QA Ruby basics", curriculum: solo.curriculum, course_delivery: "self_paced", status: :active,
  public_title: "QA Ruby basics", public_description: "A second synthetic public offering.", public_checkout_enabled: true, public_price_cents: 14900, stripe_price_id: "price_qa_other",
  settings: { "features" => { "student_experience_v2" => true } })
catalog_other.instructors << User.find(2)
catalog_other.update!(support_instructor: User.find(2))
File.write(Rails.root.join("..", ".qa-local", "first-run.json"), JSON.pretty_generate({ program: program.id, program_workspace: program.workspace.id, solo: solo.id, alumni: alumni.id, off: off.id, first: first.id, solo_first: solo_first.id, new_program: new_program.id, program_user: first_day.id }))
puts "First run fixtures ready"
