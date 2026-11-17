# W8 PR 8.1 course outline QA. Run from api/ with the owned harness DATABASE_URL.
#
#   bundle exec ruby ../scripts/qa/course-outline-fixtures.rb setup
#     Imports the canonical production-authored prework (127 lessons, the same
#     export student-workspace-course-fixtures.rb uses) into three synthetic
#     cohorts, gives the synthetic personas progress part-way through it, and
#     writes the ids to .qa-local/course-outline.json.
#   bundle exec ruby ../scripts/qa/course-outline-fixtures.rb switch on|off
#     Sets the "New student experience" override on every QA cohort, the way
#     the migration sets it Off for a running cohort. `off` is Lance's shape:
#     a running program cohort with the switch off.
#
# Synthetic people only; never reads a production database.
require_relative "boot"

path = Rails.root.join("..", ".qa-local", "course-outline.json")
case ARGV.first
when "setup"
  load File.expand_path("student-workspace-course-fixtures.rb", __dir__) unless Cohort.exists?(name: "QA canonical program")
  program = Cohort.find_by!(name: "QA canonical program")
  self_paced = Cohort.find_by!(name: "QA canonical self_paced")
  lessons = program.curriculum.modules.find_by!(name: "Prework").lessons.to_a
  instructor = User.find(2)
  ActiveRecord::Base.transaction do
    # Program (persona 3): 40 lessons in, one redo and one waiting for review; persona 4 is behind with 5.
    { 3 => 40, 4 => 5 }.each do |user_id, done|
      enrollment = program.enrollments.find_by!(user_id: user_id)
      lessons.first(done).flat_map(&:completion_blocks).each do |block|
        Progress.find_or_create_by!(enrollment: enrollment, user_id: user_id, content_block: block) { |row| row.assign_attributes(status: :completed, completed_at: 3.days.ago) }
      end
    end
    alex = program.enrollments.find_by!(user_id: 3)
    work = lessons.select { |lesson| lesson.completion_blocks.any? { |block| LessonKind.work?(block) } }
    redo_block, waiting_block = work.first(2).map { |lesson| lesson.completion_blocks.first }
    Submission.find_or_create_by!(enrollment: alex, user_id: 3, content_block: redo_block) { |row| row.assign_attributes(submission_type: :text_submission, text: "Synthetic answer", grade: "R", feedback: "Add the missing edge case.", graded_by_id: instructor.id, graded_at: 1.day.ago) }
    Submission.find_or_create_by!(enrollment: alex, user_id: 3, content_block: waiting_block) { |row| row.assign_attributes(submission_type: :text_submission, text: "Synthetic answer") }
    # Self-paced (persona 6): halfway; persona 7 is brand new.
    dana = self_paced.enrollments.find_by!(user_id: 6)
    lessons.first(63).flat_map(&:completion_blocks).each do |block|
      Progress.find_or_create_by!(enrollment: dana, user_id: 6, content_block: block) { |row| row.assign_attributes(status: :completed, completed_at: 2.days.ago) }
    end
  end
  cohorts = Cohort.where("name LIKE 'QA%'").order(:id).map { |cohort| { id: cohort.id, name: cohort.name, delivery: cohort.course_delivery, type: cohort.cohort_type } }
  path.write(JSON.pretty_generate({ cohorts: cohorts, kinds: lessons.map { |lesson| LessonKind.for(lesson) }.tally }))
  puts "Course outline fixtures: #{path}"
when "switch"
  value = { "on" => true, "off" => false }.fetch(ARGV[1])
  Cohort.where("name LIKE 'QA%'").find_each do |cohort|
    cohort.update!(settings: (cohort.settings || {}).merge("features" => (cohort.settings&.dig("features") || {}).merge("student_experience_v2" => value)))
  end
  puts "New student experience #{ARGV[1]} for #{Cohort.where("name LIKE 'QA%'").pluck(:name).join(', ')}"
else
  abort "usage: course-outline-fixtures.rb setup | switch on|off"
end
