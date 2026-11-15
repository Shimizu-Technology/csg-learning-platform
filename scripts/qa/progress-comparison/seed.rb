# Synthetic learners for the AS-10 comparison: one per learner state the old
# dashboard, plans and lesson page could disagree about. Run once, with
# `bin/rails runner`, in test mode against an empty local csg_qa_ database
# (see README.md). Every name and piece of work is invented.
abort "Run in test mode" unless Rails.env.test?
abort "Use an empty local csg_qa_ database" unless ActiveRecord::Base.connection_db_config.database.match?(/\Acsg_qa_[a-z0-9_]+\z/)
abort "Database is not empty" if User.exists? || Curriculum.exists?

ActiveRecord::Base.transaction do
  instructor = User.create!(clerk_id: "cmp_instructor", email: "cmp-instructor@example.invalid", first_name: "Cmp", last_name: "Instructor", role: :instructor)
  curriculum = Curriculum.create!(name: "Comparison Garden Lab", status: :active)
  lessons = {}
  week1 = curriculum.modules.create!(name: "Comparison Week 1", position: 0, day_offset: 0, schedule_days: "daily", module_type: :live_class)
  week2 = curriculum.modules.create!(name: "Comparison Week 2", position: 1, day_offset: 7, schedule_days: "daily", module_type: :live_class)
  build = lambda do |key, mod, day, blocks, required: true, position: 0|
    lesson = mod.lessons.create!(title: "Lab #{key.to_s.tr('_', ' ')}", release_day: day, position: position, required: required)
    blocks.each_with_index do |(type, submission_type), index|
      block = lesson.content_blocks.create!(block_type: type, position: index, title: "#{type} #{index + 1}", submission_type: submission_type == :knowledge_check ? nil : submission_type,
        body: "Count fictional seedlings.", video_url: type == :video ? "https://example.invalid/video-#{key}.mp4" : nil)
      block.create_knowledge_check!(prompt: "What is 2 + 3?", options: %w[5 9], correct_option: 0, explanation: "Five.") if submission_type == :knowledge_check
    end
    lessons[key] = lesson
  end
  build.call(:l1_counter, week1, 0, [ [ :video ], [ :exercise, :text_submission ] ])
  build.call(:l2_reading, week1, 1, [ [ :text ], [ :video ] ])
  build.call(:l3_two_steps, week1, 2, [ [ :exercise, :repo_url_submission ], [ :exercise, :manual_complete ] ])
  build.call(:l4_quick_check, week1, 3, [ [ :video ], [ :checkpoint, :knowledge_check ] ])
  build.call(:l5_prework_sync, week1, 4, [ [ :exercise, :prework_github_sync ] ])
  build.call(:l6_stretch, week1, 4, [ [ :exercise, :manual_complete ] ], required: false, position: 1)
  build.call(:l7_reviewed_checkpoint, week2, 0, [ [ :checkpoint, :text_submission ] ])
  build.call(:l8_project, week2, 1, [ [ :exercise, :repo_and_live_url_submission ] ])
  build.call(:l9_far_future, week2, 40, [ [ :exercise, :text_submission ] ])

  cohort = lambda do |name, **attrs|
    Cohort.create!({ name: name, curriculum: curriculum, start_date: Date.current - 10, status: :active }.merge(attrs)).tap do |record|
      record.instructors << instructor
    end
  end
  cohorts = {
    guided: cohort.call("Comparison Guided"),
    self_paced: cohort.call("Comparison Self-paced", course_delivery: "self_paced"),
    closed: cohort.call("Comparison Closed Week"),
    switches_off: cohort.call("Comparison Switches Off", settings: { "features" => { "knowledge_checks" => false, "github_sync" => false } }),
    alumni: cohort.call("Comparison Alumni", cohort_type: :alumni)
  }
  cohorts[:closed].cohort_module_submission_windows.create!(curriculum_module: week1, week_number: 1, submissions_close_at: 1.day.ago)

  block = ->(key, type = nil) { lessons.fetch(key).content_blocks.find { |candidate| type.nil? ? candidate.student_work_block? : candidate.block_type == type.to_s } }
  learners = {}
  learner = lambda do |key, cohort_key = :guided, status: :active, modules: [ week1, week2 ]|
    user = User.create!(clerk_id: "cmp_#{key}", email: "cmp-#{key.to_s.tr('_', '-')}@example.invalid", first_name: "Cmp", last_name: key.to_s.humanize, role: :student,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    enrollment = Enrollment.create!(user: user, cohort: cohorts.fetch(cohort_key), status: :active, joined_at: 9.days.ago)
    enrollment.module_assignments.where.not(module_id: modules.map(&:id)).destroy_all # cohort defaults assign every module
    modules.each { |mod| enrollment.module_assignments.find_or_create_by!(curriculum_module: mod) }
    learners[key] = enrollment
  end
  done = lambda do |enrollment, block_record, grade: :none, progress: :completed|
    Progress.find_or_initialize_by(enrollment: enrollment, content_block: block_record).update!(user: enrollment.user, status: progress) if progress
    unless grade == :none
      Submission.create!(user: enrollment.user, enrollment: enrollment, content_block: block_record, text: "Synthetic answer", repo_url: "https://example.invalid/repo",
        live_url: "https://example.invalid/live", grade: grade, graded_at: grade && Time.current, graded_by_id: grade && instructor.id)
    end
  end

  learner.call(:fresh)

  e = learner.call(:redo_stale_flag) # Redo from imported history: the progress flag still says completed.
  done.call(e, block.call(:l1_counter), grade: "R")

  e = learner.call(:redo_regraded)
  done.call(e, block.call(:l1_counter), grade: "R", progress: :in_progress)
  done.call(e, block.call(:l2_reading, :video))

  e = learner.call(:redo_resubmitted)
  done.call(e, block.call(:l1_counter), grade: "R", progress: :in_progress)
  done.call(e, block.call(:l1_counter), grade: nil)

  e = learner.call(:pending_grades)
  done.call(e, block.call(:l1_counter), grade: nil)
  done.call(e, block.call(:l2_reading, :video))
  lessons[:l3_two_steps].content_blocks.each { |record| done.call(e, record, grade: record.submission_type_manual_complete? ? :none : nil) }

  e = learner.call(:partial_lesson)
  done.call(e, block.call(:l1_counter), grade: "A")
  done.call(e, block.call(:l2_reading, :video))
  done.call(e, lessons[:l3_two_steps].content_blocks.last)

  e = learner.call(:all_open_work_done)
  lessons.each_value do |lesson|
    next if lesson.release_day > 30

    lesson.completion_blocks.each { |record| done.call(e, record, grade: record.gradable_work_block? ? "B" : :none) }
  end

  e = learner.call(:plan_with_redo)
  done.call(e, block.call(:l1_counter), grade: "R")
  e.create_learning_plan!(title: "Comparison plan", active: true, target_date: Date.current + 21,
    milestones: [ { "title" => "Project first", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ lessons[:l4_quick_check].id, lessons[:l1_counter].id ] } ],
    lesson_overrides: [ { "lesson_id" => lessons[:l2_reading].id, "required" => false, "reason" => "Covered in a synthetic workshop" } ])

  e = learner.call(:plan_partial_milestones)
  done.call(e, block.call(:l1_counter), grade: "A")
  e.create_learning_plan!(title: "Comparison partial plan", active: true,
    milestones: [ { "title" => "Later lab", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ lessons[:l7_reviewed_checkpoint].id ] } ])

  e = learner.call(:self_paced_redo, :self_paced)
  done.call(e, block.call(:l1_counter), grade: "R")
  done.call(e, block.call(:l2_reading, :video))

  e = learner.call(:closed_week, :closed)
  done.call(e, block.call(:l1_counter), grade: "A")

  e = learner.call(:switches_off, :switches_off)
  done.call(e, block.call(:l1_counter), grade: "A")
  done.call(e, block.call(:l2_reading, :video))
  done.call(e, block.call(:l4_quick_check, :checkpoint))
  done.call(e, block.call(:l5_prework_sync), grade: nil)

  e = learner.call(:lesson_only, modules: [ week1 ])
  e.lesson_assignments.create!(lesson: lessons[:l8_project], unlocked: true)
  done.call(e, block.call(:l1_counter), grade: "A")

  e = learner.call(:paused)
  done.call(e, block.call(:l1_counter), grade: "R")
  e.update!(status: :paused)
  e.update_columns(paused_at: 6.days.ago)

  learner.call(:alumni_library, :alumni)

  # Release dates count from module creation and assignment for paused learners.
  ModuleAssignment.update_all(created_at: 20.days.ago, updated_at: 20.days.ago, availability_changed_at: 20.days.ago)
  LessonAssignment.update_all(created_at: 20.days.ago, updated_at: 20.days.ago, availability_changed_at: 20.days.ago)
  Lesson.update_all(created_at: 20.days.ago)
  puts JSON.pretty_generate(learners.transform_values { |enrollment| { user_id: enrollment.user_id, cohort: enrollment.cohort.name } })
end
