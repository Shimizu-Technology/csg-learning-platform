# A shared curriculum used by two cohorts, with learner data in every table
# CurriculumCopyForCohort moves (synthetic data only). Cohort 3 gets the copy;
# Cohort 4 keeps the shared curriculum.
module CurriculumCopyFixture
  Built = Struct.new(:curriculum, :cohort, :other_cohort, :admin, :instructor, :ungranted, :learner, :classmate, :other_learner,
    :modules, :lessons, :blocks, :check, :objective, :rubric, :criterion, :resource, :pending_resource,
    :rows, keyword_init: true)

  def build_shared_curriculum(slug: SecureRandom.hex(4))
    curriculum = Curriculum.create!(name: "Synthetic Web Lab #{slug}", status: :active, course_package_revision: "rev-7", course_package_digest: "digest-#{slug}")
    objective = curriculum.learning_objectives.create!(code: "WEB.#{slug.first(3).upcase}", title: "Ship an interface", success_criteria: "I can ship one.", position: 0)
    rubric = Rubric.create!(curriculum: curriculum, title: "Interface quality", rubric_criteria_attributes: [
      { title: "Behavior", description: "It works.", learning_objective: objective }
    ])
    criterion = rubric.rubric_criteria.first
    week1 = CurriculumModule.create!(curriculum: curriculum, name: "Week one", position: 0, day_offset: 0, schedule_days: "weekdays", course_package_key: "week-one")
    week2 = CurriculumModule.create!(curriculum: curriculum, name: "Week two", position: 1, day_offset: 7, schedule_days: "weekdays")
    intro = Lesson.create!(curriculum_module: week1, title: "Intro", position: 0, release_day: 0)
    project = Lesson.create!(curriculum_module: week1, title: "Project", position: 1, release_day: 1, requires_submission: true)
    retired = Lesson.create!(curriculum_module: week1, title: "Retired", position: 2, release_day: 2, archived_at: 2.days.ago)
    later = Lesson.create!(curriculum_module: week2, title: "Later", position: 0, release_day: 0)
    read = intro.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Next: [Project](/lessons/#{project.id}#block-PLACEHOLDER) and [week two](/modules/#{week2.id}).")
    video = intro.content_blocks.create!(block_type: :video, position: 1, title: "Watch", video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    check_block = intro.content_blocks.create!(block_type: :checkpoint, position: 2, title: "Check")
    check = KnowledgeCheck.create!(content_block: check_block, learning_objective: objective, prompt: "Pick one", options: [ "Yes", "No" ], correct_option: 0, explanation: "Yes.")
    exercise = project.content_blocks.create!(block_type: :exercise, position: 0, title: "Build it", rubric: rubric, submission_type: :text_submission)
    old_note = retired.content_blocks.create!(block_type: :text, position: 0, title: "Old", body: "Old.")
    later_read = later.content_blocks.create!(block_type: :text, position: 0, title: "Later read", body: "Later.")
    read.update_columns(body: read.body.sub("PLACEHOLDER", exercise.id.to_s))
    ObjectiveAlignment.create!(learning_objective: objective, lesson: project, content_block: exercise)
    ObjectiveAlignment.create!(learning_objective: objective, lesson: intro)
    resource = curriculum.curriculum_resources.create!(title: "Starter ZIP", filename: "starter.zip", file_size: 123,
      s3_key: "course_resources/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/starter.zip",
      upload_key: "course_resource_uploads/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/starter.zip",
      upload_expires_at: 1.hour.from_now, ready: true)
    pending = curriculum.curriculum_resources.create!(title: "Draft ZIP", filename: "draft.zip", file_size: 123,
      s3_key: "course_resources/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/draft.zip",
      upload_key: "course_resource_uploads/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/draft.zip",
      upload_expires_at: 1.hour.from_now, ready: false)

    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3 #{slug}", start_date: Date.current - 20, status: :active)
    other = Cohort.create!(curriculum: curriculum, name: "Cohort 4 #{slug}", start_date: Date.current - 20, status: :active)
    admin = copy_user(:admin, "admin-#{slug}", "Leon")
    instructor = copy_user(:instructor, "instructor-#{slug}", "Audreana")
    ungranted = copy_user(:instructor, "ungranted-#{slug}", "Una")
    learner = copy_user(:student, "learner-#{slug}", "Maya")
    classmate = copy_user(:student, "classmate-#{slug}", "Noah")
    other_learner = copy_user(:student, "other-#{slug}", "Ollie")
    assignment = CohortInstructorAssignment.create!(cohort: cohort, user: instructor)
    assignment.set_lesson_editing!(true, by: admin)
    CohortInstructorAssignment.create!(cohort: cohort, user: ungranted)
    CohortInstructorAssignment.create!(cohort: other, user: ungranted)

    rows = Hash.new { |hash, key| hash[key] = [] }
    { cohort => [ learner, classmate ], other => [ other_learner ] }.each do |course, people|
      course.update!(content_defaults: { week1.id.to_s => { "assigned" => true, "unlocked" => true, "unlock_date_override" => nil },
                                         week2.id.to_s => { "assigned" => true, "unlocked" => false, "unlock_date_override" => nil } })
      rows[:schedules] << CohortModuleSchedule.create!(cohort: course, curriculum_module: week1, start_date: Date.current.beginning_of_week - 14)
      rows[:windows] << CohortModuleSubmissionWindow.create!(cohort: course, curriculum_module: week1, week_number: 1, submissions_close_at: 3.days.from_now)
      people.each do |person|
        enrollment = Enrollment.create!(user: person, cohort: course, status: :active)
        rows[:module_assignments] << ModuleAssignment.create!(enrollment: enrollment, curriculum_module: week1, unlocked: true)
        rows[:module_assignments] << ModuleAssignment.create!(enrollment: enrollment, curriculum_module: week2, unlocked: false, unlock_date_override: Date.current + 30)
        rows[:lesson_assignments] << LessonAssignment.create!(enrollment: enrollment, lesson: later, unlocked: true)
        rows[:progresses] << Progress.create!(user: person, enrollment: enrollment, content_block: read, status: :completed)
        rows[:progresses] << Progress.create!(user: person, enrollment: enrollment, content_block: video, status: :in_progress, video_last_position: 40, video_total_watched: 40, video_duration: 100, watch_credit_fraction: 0.4)
        rows[:attempts] << check.attempts.create!(user: person, enrollment: enrollment, selected_option: 0, correct: true)
        rows[:progresses] << Progress.create!(user: person, enrollment: enrollment, content_block: check_block, status: :completed)
        submission = Submission.create!(user: person, enrollment: enrollment, content_block: exercise, text: "Synthetic answer", grade: (person == learner ? :R : :A),
          feedback: "Synthetic feedback", grader: admin, graded_at: 1.day.ago, num_submissions: 1)
        rows[:submissions] << submission
        rows[:criterion_results] << submission.submission_criterion_results.create!(rubric_criterion: criterion, rating: (person == learner ? :redo : :meets))
        rows[:check_runs] << submission.github_check_runs.create!(external_id: rand(1..1_000_000), name: "test", head_sha: "abc123", status: "completed", conclusion: "success", fetched_at: Time.current)
        rows[:activity_events] << ActivityEvent.record!(event_type: "checkpoint_completed", actor: person, cohort: course, record: read)
        rows[:help_requests] << HelpRequest.create!(student: person, cohort: course, category: :concept, context_type: :lesson, context_id: intro.id,
          context_label: "Intro", context_path: "/lessons/#{intro.id}?cohort_id=#{course.id}", message: "Synthetic question")
        rows[:help_requests] << HelpRequest.create!(student: person, cohort: course, category: :concept, context_type: :exercise, context_id: exercise.id,
          context_label: "Build it", context_path: "/lessons/#{project.id}?cohort_id=#{course.id}#block-#{exercise.id}", message: "Synthetic exercise question")
        rows[:notifications] << Notification.create!(user: person, notifiable: submission, notification_type: :redo, title: "Graded",
          path: "/lessons/#{project.id}?cohort_id=#{course.id}#block-#{exercise.id}")
        conversation = DirectConversation.find_or_create_for!(workspace: course.workspace, users: [ admin, person ])
        rows[:messages] << Message.create!(author: admin, direct_conversation: conversation, body: "About this lesson", source: intro)
      end
    end
    learner_enrollment = cohort.enrollments.find_by!(user: learner)
    plan = LearningPlan.create!(enrollment: learner_enrollment, title: "Catch-up",
      milestones: [ { "title" => "Project first", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ project.id, intro.id ] } ],
      lesson_overrides: [ { "lesson_id" => later.id, "required" => false, "reason" => "Optional for this learner" } ])
    rows[:learning_plans] << plan
    rows[:learning_plan_revisions] << plan.revisions.create!(author: admin, snapshot: plan.snapshot)
    # Older rows saved before enrollments existed: this learner is only in Cohort 3.
    rows[:legacy_progresses] << Progress.create!(user: classmate, enrollment: nil, content_block: later_read, status: :completed)

    Built.new(curriculum: curriculum, cohort: cohort, other_cohort: other, admin: admin, instructor: instructor, ungranted: ungranted,
      learner: learner, classmate: classmate, other_learner: other_learner,
      modules: [ week1, week2 ], lessons: { intro: intro, project: project, retired: retired, later: later },
      blocks: { read: read, video: video, check: check_block, exercise: exercise, old_note: old_note, later_read: later_read },
      check: check, objective: objective, rubric: rubric, criterion: criterion, resource: resource, pending_resource: pending, rows: rows)
  end

  def copy_user(role, slug, first_name)
    User.create!(clerk_id: "clerk_copy_#{slug}", email: "copy-#{slug}@example.invalid", first_name: first_name, last_name: "Tester", role: role,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  end

  # Every row of the fixture in `scope`'s table, as comparable attributes.
  def snapshot_rows(records)
    records.map { |record| record.class.find(record.id).attributes.except("updated_at") }
  end
end
