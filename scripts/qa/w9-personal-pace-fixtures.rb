# W9.1 personal pace browser QA fixture. Run from api/ with the owned harness
# DATABASE_URL after `scripts/qa/run start`:
#
#   bundle exec ruby ../scripts/qa/w9-personal-pace-fixtures.rb setup
#     A guided "QA Python pilot" cohort (started 3 days ago, pace choices
#     3, 4 and 6 weeks) on a synthetic 13-lesson course (12 exercises and a
#     final project), taught by persona 2, with two new learners:
#     901 "QA Rehearsal" and 902 "QA Late". Writes ids to .qa-local/w9-pace.json.
#   bundle exec ruby ../scripts/qa/w9-personal-pace-fixtures.rb fixes
#     (Re)sets the three review-fix cases (PR #313 round 2), after setup:
#     903 in a self-paced paced course whose staff chose 4 weeks before the
#     first open; 904 in the pilot with the course held back until 30 days
#     from now; 905 in the pilot with 4 weeks chosen and the final project
#     already finished; 906 in the pilot with 4 weeks chosen by staff and the
#     course not yet opened. Resets the pilot start to 3 days ago. Writes ids
#     to .qa-local/w9-pace-fixes.json.
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
  # The cohort-start case in w9-personal-pace-fixes.spec.ts moves it.
  Cohort.find_by(name: "QA Python pilot")&.update!(start_date: Date.current - 3)
end

fix_learner = lambda do |id, name, cohort|
  user = User.find_or_create_by!(id: id) do |row|
    row.assign_attributes(clerk_id: "qa_w9_#{name}", email: "w9-#{name}@example.invalid", first_name: "QA", last_name: name.capitalize, role: :student,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  end
  Progress.where(user_id: user.id).delete_all # an enrollment delete keeps (nullifies) these
  Enrollment.where(user: user).destroy_all
  Enrollment.create!(user: user, cohort: cohort, status: :active).tap(&:assign_cohort_content_defaults!)
end

case ARGV.first
when "fixes"
  pilot = Cohort.find_by!(name: "QA Python pilot")
  admin = User.find(1)
  ids = {}
  ActiveRecord::Base.transaction do
    on_demand = Cohort.find_by(name: "QA Python on demand") || Cohort.create!(name: "QA Python on demand", curriculum: pilot.curriculum,
      start_date: Date.current - 21, status: :active, course_delivery: "self_paced", learner_pace_weeks: [ 3, 4, 6 ])
    on_demand.instructors << User.find(2) unless on_demand.instructors.exists?(2)
    # Staff chose 4 weeks before the learner ever opened the course.
    self_paced = fix_learner.call(903, "ondemand", on_demand)
    LearnerPace.new(self_paced).choose!(weeks: 4, actor: admin)

    # The pilot starts 3 days ago in every pass (the cohort-start case moves it).
    pilot.update!(start_date: Date.current - 3)
    # Staff chose 4 weeks; the learner hasn't opened the course.
    unopened = fix_learner.call(906, "cohortstart", pilot)
    LearnerPace.new(unopened).choose!(weeks: 4, actor: admin)

    held = fix_learner.call(904, "heldback", pilot)
    held.module_assignments.update_all(unlock_date_override: Date.current + 30)

    finished = fix_learner.call(905, "finished", pilot)
    finished.update_column(:first_opened_at, Time.current)
    LearnerPace.new(finished.reload).choose!(weeks: 4, actor: finished.user)
    project = pilot.curriculum.modules.first.lessons.find_by!(lesson_type: :project)
    project.completion_blocks.each do |block|
      Progress.create!(enrollment: finished, user: finished.user, content_block: block, status: :completed, completed_at: Time.current)
    end
    ids.merge!("on_demand_cohort" => on_demand.id, "self_paced" => { user: 903, enrollment: self_paced.id },
      "held" => { user: 904, enrollment: held.id }, "unopened" => { user: 906, enrollment: unopened.id }, "finished" => { user: 905, enrollment: finished.id }, "project_lesson" => project.id)
  end
  Rails.root.join("..", ".qa-local", "w9-pace-fixes.json").write(JSON.pretty_generate(ids))
  puts JSON.pretty_generate(ids)
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
  abort "usage: w9-personal-pace-fixtures.rb setup | fixes | reset"
end
