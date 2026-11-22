# After scripts/qa/run start, run from api/ with the harness DATABASE_URL.
# Own synthetic users, cohorts and lessons share one curriculum.
require_relative "boot"

ids = ActiveRecord::Base.transaction do
  curriculum = Curriculum.create!(name: "QA replay curriculum", status: :active)
  mod = curriculum.modules.create!(name: "Python practice", position: 0, day_offset: 0, schedule_days: "daily")
  monday = LearningCalendar.today.beginning_of_week(:monday)
  first = mod.lessons.create!(title: "Reading a stack trace", position: 0, release_day: 0, lesson_type: :reading)
  second = mod.lessons.create!(title: "Tracing a function call", position: 0, release_day: 7, lesson_type: :reading)
  [ first, second ].each do |lesson|
    lesson.content_blocks.create!(block_type: :text, title: "Read", position: 0, body: "A synthetic lesson for recording QA.")
  end

  cohorts = %w[Primary Shared Legacy].map.with_index do |label, index|
    cohort = Cohort.create!(name: "QA Replay #{label}", curriculum: curriculum, start_date: monday - 14, status: :active,
      settings: { "features" => { "student_experience_v2" => label != "Legacy", "recordings" => true } })
    user = User.create!(id: 911 + index, clerk_id: "qa_replay_#{index}", email: "qa-replay-#{index}@example.invalid",
      first_name: "QA", last_name: label, role: :student, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    enrollment = cohort.enrollments.create!(user: user, status: :active)
    enrollment.assign_cohort_content_defaults!
    enrollment.module_assignments.find_by!(curriculum_module: mod).update!(unlocked: true)
    { cohort: cohort.id, user: user.id }
  end
  Cohort.find(cohorts.first[:cohort]).instructors << User.find(2)
  legacy_recording = Cohort.find(cohorts.last[:cohort]).recordings.create!(title: "Legacy workspace replay",
    source_kind: "external", source_url: "https://example.invalid/legacy-class", duration_seconds: 150, status: :published)
  legacy_recording.lesson_recordings.create!(lesson: first)

  {
    lesson: first.id, other_lesson: second.id, recorded_date: (monday - 13).iso8601,
    primary: cohorts[0], shared: cohorts[1], legacy: cohorts[2]
  }
end
Rails.root.join("..", ".qa-local", "w9-lesson-recordings.json").write(JSON.pretty_generate(ids))
puts JSON.pretty_generate(ids)
