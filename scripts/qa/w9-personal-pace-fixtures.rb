# W9.1 personal pace browser QA fixture. Run from api/ with the owned harness
# DATABASE_URL after `scripts/qa/run start`:
#
#   bundle exec ruby ../scripts/qa/w9-personal-pace-fixtures.rb setup
#     A guided "QA Python pilot" cohort (started 3 days ago, pace choices
#     3, 4 and 6 weeks) on a synthetic 13-lesson course (12 exercises and a
#     final project), taught by persona 2, with two new learners:
#     901 "QA Rehearsal" and 902 "QA Late". Writes ids to .qa-local/w9-pace.json.
#   bundle exec ruby ../scripts/qa/w9-personal-pace-fixtures.rb reset
#     Puts both learners back to "never opened, no pace, no staff start", so a
#     browser pass can run the journey again.
#
# Synthetic people and content only; never reads a production database.
require_relative "boot"

path = Rails.root.join("..", ".qa-local", "w9-pace.json")
learner_ids = [ 901, 902 ]

reset = lambda do
  enrollments = Enrollment.where(user_id: learner_ids)
  LearningPlan.where(enrollment_id: enrollments.select(:id)).destroy_all
  Progress.where(enrollment_id: enrollments.select(:id)).delete_all
  enrollments.update_all(first_opened_at: nil, starts_on: nil, start_here_dismissed_at: nil, joined_at: nil)
end

case ARGV.first
when "reset"
  reset.call
  puts "Learners #{learner_ids.join(', ')} reset"
when "setup"
  ids = {}
  ActiveRecord::Base.transaction do
    curriculum = Curriculum.create!(name: "QA Python Fundamentals", status: :active)
    mod = curriculum.modules.create!(name: "Python Fundamentals", position: 0, day_offset: 0, schedule_days: "weekdays")
    titles = [ "Your first program", "Variables and values", "Strings", "Numbers and math", "Making decisions", "Loops",
      "Lists", "Dictionaries", "Functions", "Reading files", "Errors and debugging", "Putting it together" ]
    titles.each_with_index do |title, index|
      lesson = mod.lessons.create!(title: title, position: index, release_day: (index / 4) * 7 + (index % 4), lesson_type: :exercise, required: true)
      lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "A short synthetic reading for #{title.downcase}.")
      lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Practice", body: "Write a small program.", submission_type: :text_submission)
    end
    project = mod.lessons.create!(title: "Final project: a to-do list app", position: 12, release_day: 18, lesson_type: :project, required: true)
    project.content_blocks.create!(block_type: :text, position: 0, title: "Brief", body: "Build a small to-do list program.")
    project.content_blocks.create!(block_type: :exercise, position: 1, title: "Hand in", body: "Paste your program.", submission_type: :text_submission)

    cohort = Cohort.create!(name: "QA Python pilot", curriculum: curriculum, start_date: Date.current - 3, status: :active,
      course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    cohort.instructors << User.find(2)
    { 901 => "Rehearsal", 902 => "Late" }.each do |id, name|
      user = User.create!(id: id, clerk_id: "qa_w9_#{name.downcase}", email: "w9-#{name.downcase}@example.invalid", first_name: "QA", last_name: name, role: :student,
        community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
      enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
      enrollment.assign_cohort_content_defaults!
      ids[name.downcase] = { user: id, enrollment: enrollment.id }
    end
    ids["cohort"] = cohort.id
    ids["program_cohort"] = Cohort.find_by!(name: "QA Program").id
    ids["project_lesson"] = project.id
  end
  path.write(JSON.pretty_generate(ids))
  puts JSON.pretty_generate(ids)
else
  abort "usage: w9-personal-pace-fixtures.rb setup | reset"
end
