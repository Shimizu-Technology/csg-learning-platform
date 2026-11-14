require_relative 'boot'
abort 'Seed requires an empty QA database' if User.exists? || Curriculum.exists?
people = {}
ActiveRecord::Base.transaction do
  %w[admin instructor program behind paused self_paced new_student alumni].each_with_index do |name, index|
    user = User.create!(id: index + 1, clerk_id: "qa_#{name}", email: "#{name}@example.invalid", first_name: 'QA', last_name: name.humanize,
                        role: index < 2 ? name : 'student', community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION,
                        last_sign_in_at: 14.days.ago, last_seen_at: name == 'behind' ? 12.days.ago : Time.current)
    ClerkIdentity.create!(user: user, issuer: 'https://test.clerk.invalid', clerk_user_id: user.clerk_id)
    people[name] = user
  end
  cohorts = {}
  %w[program self_paced alumni].each do |kind|
    curriculum = Curriculum.create!(name: "QA #{kind.humanize} Lab", status: :active)
    rubric = curriculum.rubrics.create!(title: 'Synthetic clarity rubric',
                                        rubric_criteria_attributes: [ { title: 'Explain your approach', description: 'Describe the fictional solution clearly',
                                                                       position: 0 } ])
    3.times do |week|
      mod = curriculum.modules.create!(name: "QA Week #{week + 1}", position: week, day_offset: week * 7,
                                       module_type: week.zero? ? :prework : :live_class, schedule_days: 'weekdays')
      [ 0, 1, 2 ].each do |day|
        2.times do |position|
          lesson = mod.lessons.create!(title: "QA Lab #{week + 1}.#{day + 1}.#{position + 1}", position: position,
                                       release_day: day, required: true)
          lesson.content_blocks.create!(block_type: :text, position: 0, title: 'Read',
                                        body: "# Synthetic garden counter\nCount fictional seedlings.\n\n```ruby\nputs 2 + 3\n```")
          lesson.content_blocks.create!(block_type: :video, position: 1, title: 'Video placeholder', video_url: 'https://example.invalid/qa-video.mp4')
          lesson.content_blocks.create!(block_type: :exercise, position: 2, title: 'Practice',
                                        body: 'Explain a fictional counter.', submission_type: position.zero? ? :text_submission : :repo_url_submission, rubric: rubric)
          lesson.content_blocks.create!(block_type: :exercise, position: 3, title: 'Reflect',
                                        submission_type: :manual_complete)
          check = lesson.content_blocks.create!(block_type: :checkpoint, position: 4, title: 'Synthetic check')
          check.create_knowledge_check!(prompt: 'In this invented example, what is 2 + 3?', options: %w[5 9],
                                        correct_option: 0, explanation: 'Two plus three is five; this is synthetic practice.')
        end
      end
    end
    cohort = Cohort.create!(name: "QA #{kind.humanize}", curriculum: curriculum, start_date: Date.current - 21,
                            status: :active, cohort_type: kind == 'alumni' ? :alumni : :bootcamp, course_delivery: kind == 'self_paced' ? 'self_paced' : 'program')
    cohort.instructors << people.fetch('instructor')
    cohort.update!(support_instructor: people.fetch('instructor')) if kind == 'self_paced'
    cohorts[kind] = cohort
  end
  ActiveRecord::Base.connection.reset_pk_sequence!('users')
  people.each do |name, user|
    next if user.staff?

    kind = if %w[self_paced new_student].include?(name)
             'self_paced'
    else
             name == 'alumni' ? 'alumni' : 'program'
    end
    cohort = cohorts.fetch(kind)
    enrollment = Enrollment.create!(user: user, cohort: cohort, status: name == 'paused' ? :paused : :active)
    enrollment.assign_cohort_content_defaults! unless kind == 'alumni'
    if %w[program self_paced].include?(name)
      blocks = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: cohort.curriculum_id },
                                                                    block_type: :exercise, submission_type: :text_submission).order(:id).first(3)
      blocks.each_with_index do |block, i|
        Submission.create!(user: user, enrollment: enrollment, content_block: block, submission_type: :text_submission,
                           text: "Synthetic counter explanation #{i}", grade: [ :A, :R, nil ][i], graded_by_id: i < 2 ? people.fetch('instructor').id : nil, graded_at: i < 2 ? Time.current : nil)
      end
      if name == 'self_paced'
        ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: cohort.curriculum_id }).order(:id).first(45).each do |block|
          Progress.create!(user: user, enrollment: enrollment, content_block: block, status: :completed, completed_at: Time.current)
        end
      end
      enrollment.create_learning_plan!(title: 'QA steady practice', active: true, target_date: Date.current + 14,
        milestones: [ { 'title' => 'Practice the first lab', 'due_on' => (Date.current + 7).iso8601, 'lesson_ids' => [ blocks.first.lesson_id ] } ])
    end
    next unless name == 'behind'

    lesson = cohort.curriculum.modules.first.lessons.first
    help = HelpRequest.create!(student: user, cohort: cohort, category: :concept, context_type: :lesson, context_id: lesson.id,
                               context_label: lesson.title, context_path: "/lessons/#{lesson.id}", message: 'I need help with this synthetic counter.')
    Intervention.create!(enrollment: enrollment, help_request: help, owner: people.fetch('instructor'),
                         created_by: people.fetch('admin'), trigger_type: :help_request, next_follow_up_at: 1.day.from_now, action_summary: 'Follow up on fictional practice')
  end
  cohort = cohorts.fetch('program')
  conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace,
                                                        users: [
                                                          people.fetch('instructor'), people.fetch('program')
                                                        ])
  Message.create!(direct_conversation: conversation, author: people.fetch('program'),
                  body: "**Practice question**\n```ruby\nputs 5\n```")
  channel = cohort.channels.create!(name: 'qa-class', workspace: cohort.workspace)
  Message.create!(channel: channel, author: people.fetch('instructor'), body: 'Welcome to the synthetic lab.')
  Announcement.create!(cohort: cohort, author: people.fetch('admin'), title: 'QA practice week',
                       body: 'Bring your fictional counter questions.', audience: :cohort, status: :published)
  cohort.recordings.create!(title: 'QA counter walkthrough', source_kind: 'external',
                            source_url: 'https://example.invalid/recording', status: :published, recorded_date: Date.current, position: 0)
  cohort.office_hours.create!(title: 'QA weekly support', starts_at: 1.day.from_now, ends_at: 1.day.from_now + 1.hour,
                              recurrence: :weekly, meeting_url: 'https://example.invalid/meeting', created_by: people.fetch('instructor'))
end
puts JSON.pretty_generate(people.transform_values { |user| { id: user.id, role: user.role } })
