# Synthetic fixtures for the plan editor and instructor meetings QA
# (docs/qa/plan-editor-meetings-2026-11-17.md). Run once after `scripts/qa/run start`,
# from api/: DATABASE_URL=postgresql://localhost/<qa db> bundle exec ruby ../scripts/qa/plan-editor-meetings-fixtures.rb
#
# - "QA Catch-up Lab": 240 invented lessons (60 prework, then three live modules
#   of four weeks each), so the editor is checked at the size the audit measured.
# - The behind student (persona 4) gets a second enrollment there with all
#   prework and the first JavaScript week finished, one redo and no plan.
# - Meetings: QA Program's meetings are hosted by the admin, and QA Catch-up has
#   meetings switched on with no host, so the instructor (persona 2) hosts nothing.
require_relative 'boot'
abort 'Fixtures already loaded' if Curriculum.exists?(name: 'QA Catch-up Lab')

admin = User.find(1)
instructor = User.find(2)
student = User.find(4)
ActiveRecord::Base.transaction do
  curriculum = Curriculum.create!(name: 'QA Catch-up Lab', status: :active)
  modules = [
    [ 'QA Prework', :prework, 60, 'daily' ],
    [ 'QA JavaScript Foundations', :live_class, 60, 'weekdays' ],
    [ 'QA React', :live_class, 60, 'weekdays' ],
    [ 'QA Backend', :live_class, 60, 'weekdays' ]
  ].each_with_index.map do |(name, type, count, days), index|
    mod = curriculum.modules.create!(name: name, position: index, day_offset: index * 28, module_type: type, schedule_days: days)
    count.times do |n|
      # Weekdays: three lessons a day, five days a week, four weeks.
      release_day = days == 'daily' ? n / 3 : ((n / 15) * 7) + ((n / 3) % 5)
      lesson = mod.lessons.create!(title: "#{name.delete_prefix('QA ')} lesson #{n + 1}", position: n % 3, release_day: release_day, required: n % 10 != 9)
      lesson.content_blocks.create!(block_type: :exercise, position: 0, title: 'Practice', submission_type: n % 4 == 0 ? :text_submission : :manual_complete,
        body: 'Explain a fictional counter.')
    end
    mod
  end
  cohort = Cohort.create!(name: 'QA Catch-up', curriculum: curriculum, start_date: Date.current - 35, status: :active, cohort_type: :bootcamp, course_delivery: 'program')
  cohort.instructors << instructor
  enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
  enrollment.assign_cohort_content_defaults!
  enrollment.module_assignments.update_all(unlocked: true)
  finished = modules[0].lessons.to_a + modules[1].lessons.order(:release_day, :position, :id).first(15)
  finished.each do |lesson|
    block = lesson.content_blocks.first
    if block.submission_type == 'text_submission'
      Submission.create!(user: student, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: 'Synthetic answer', grade: :B, graded_by_id: instructor.id, graded_at: Time.current)
    else
      Progress.create!(user: student, enrollment: enrollment, content_block: block, status: :completed, completed_at: Time.current)
    end
  end
  redo_lesson = modules[1].lessons.order(:release_day, :position, :id).offset(15).detect { |lesson| lesson.content_blocks.first.submission_type == 'text_submission' }
  Submission.create!(user: student, enrollment: enrollment, content_block: redo_lesson.content_blocks.first, submission_type: :text_submission, text: 'Synthetic first try', grade: :R, feedback: 'Please explain each step.', graded_by_id: instructor.id, graded_at: Time.current)

  PrivateMeetingConfig.create!(cohort: Cohort.find_by!(name: 'QA Program'), instructor: admin)
  puts({ cohort_id: cohort.id, enrollment_id: enrollment.id, lessons: curriculum.modules.sum { |mod| mod.lessons.count }, finished: finished.size, redo: redo_lesson.title }.to_json)
end
