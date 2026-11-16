# Additive, synthetic-only W7 PR 7.3 fixtures (Grading workbench and module grid).
# Run after scripts/qa/run start, from api/:
#   DATABASE_URL=postgres://localhost/<csg_qa_ database> bundle exec ruby ../scripts/qa/grading-fixtures.rb
#
# Adds a three-week module to QA Program in which week 1 is fully graded and
# weeks 2 and 3 have work waiting (different ages), a Markdown answer, a code
# file answer and two exercises whose titles look alike once cut, plus four
# invented learners. All names, answers and curriculum are made up.
require_relative 'boot'
abort 'Grading fixtures already installed' if CurriculumModule.exists?(name: 'QA Grading Module')

cohort = Cohort.find_by!(name: 'QA Program')
admin = User.find(1)
instructor = User.find(2)
mod = cohort.curriculum.modules.create!(name: 'QA Grading Module', position: 3, day_offset: 21, module_type: :live_class, schedule_days: 'daily')

def exercise(mod, title, day, position, filename: nil)
  lesson = mod.lessons.create!(title: title, position: position, release_day: day, required: true)
  lesson.content_blocks.create!(block_type: :text, position: 0, title: 'Read', body: "Synthetic reading for #{title}.")
  lesson.content_blocks.create!(block_type: :exercise, position: 1, title: filename ? 'Ticket prices' : title, filename: filename,
                                body: "Write `ticketPrice(age)`: invented prices for an invented cinema.\n\n- Under 12 pays 5\n- 65 and over pays 6",
                                submission_type: :text_submission)
end

week_one = [ exercise(mod, 'Practice: loops over arrays', 0, 0), exercise(mod, 'Practice: loops over objects', 0, 1) ]
week_two = [ exercise(mod, 'Make Decisions with JavaScript', 7, 0), exercise(mod, 'Ticket prices file', 8, 1, filename: 'ticket-price.js') ]
week_three = [ exercise(mod, 'Functions Recap', 14, 0) ]

markdown = <<~MD
  I used `if` / `else if` / `else` so only **one** price is returned. I checked the child case first.

  ```js
  ticketPrice(12) // 10
  ticketPrice(65) // 6
  ```

  - Tested exactly 12
  - Tested exactly 65
MD
code = <<~JS
  function ticketPrice(age) {
    if (age < 12) {
      return 5
    } else if (age >= 65) {
      return 6
    }
    return 10
  }
JS

learners = %w[Avery Briar Corin Dale].each_with_index.map do |name, index|
  user = User.create!(clerk_id: "qa_grading_#{name.downcase}", email: "grading-#{name.downcase}@example.invalid", first_name: name,
                      last_name: 'Synthetic', role: :student, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
  enrollment.assign_cohort_content_defaults!
  ModuleAssignment.find_or_create_by!(enrollment: enrollment, curriculum_module: mod).update!(unlocked: true)
  [ user, enrollment, index ]
end

def submit(user, enrollment, block, text, age, grade: nil, by: nil)
  Submission.create!(user: user, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: text,
                     created_at: age.ago, updated_at: age.ago, grade: grade, graded_by_id: grade && by&.id, graded_at: grade && (age - 1.hour).ago,
                     feedback: grade == :R ? 'Synthetic redo note: check the edge cases.' : nil)
end

learners.each do |user, enrollment, index|
  # Week 1: all graded.
  week_one.each { |block| submit(user, enrollment, block, "Synthetic loop answer by #{user.first_name}.", (20 - index).days, grade: %i[A B][index % 2], by: instructor) }
  # Week 2: waiting, of different ages (one over a week).
  submit(user, enrollment, week_two[0], markdown, [ 9.days, 3.days, 26.hours, 5.hours ][index])
  submit(user, enrollment, week_two[1], code, [ 2.days, 30.hours, 4.hours, 50.minutes ][index]) if index < 3
end
avery, avery_enrollment, = learners.first
# Week 3: a redo, then a resubmission waiting (only the latest attempt counts).
submit(avery, avery_enrollment, week_three[0], 'First synthetic attempt.', 4.days, grade: :R, by: admin)
second = submit(avery, avery_enrollment, week_three[0], 'Second synthetic attempt, with the edge cases.', 1.day)
second.update_columns(num_submissions: 2)
briar, briar_enrollment, = learners[1]
submit(briar, briar_enrollment, week_three[0], 'Synthetic attempt that needs another pass.', 2.days, grade: :R, by: instructor)

puts "Grading fixtures: module #{mod.id} in cohort #{cohort.id}; #{Submission.joins(:enrollment).where(enrollments: { cohort_id: cohort.id }, grade: nil).count} waiting rows"
