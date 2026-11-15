require_relative "../support/model_coverage"

# Exercise existing indexes and CHECKs with writes that bypass validations.
class DatabaseIntegrityTest < ModelCoverageTestCase
  test "progress uniqueness separates enrollment credit from legacy user credit" do
    legacy = Progress.create!(user: student, content_block: block)
    current = Progress.create!(user: student, enrollment: enrollment, content_block: block)
    assert_database_rejects current, { enrollment_id: nil }, ActiveRecord::RecordNotUnique, constraint: "idx_progresses_legacy_user_block"
    other = Progress.create!(user: person, content_block: block)
    assert_database_rejects other, { enrollment_id: enrollment.id }, ActiveRecord::RecordNotUnique, constraint: "idx_progresses_enrollment_block"
    assert legacy.persisted?
  end

  test "module assignments are unique per enrollment and module" do
    row = enrollment.module_assignments.create!(curriculum_module: mod)
    second = CurriculumModule.create!(curriculum: curriculum, name: "Other", position: 1)
    other = enrollment.module_assignments.create!(curriculum_module: second)
    assert_database_rejects other, { module_id: row.module_id }, ActiveRecord::RecordNotUnique, constraint: "index_module_assignments_on_enrollment_id_and_module_id"
  end

  test "cohort delivery price and terms are database constraints" do
    assert_database_rejects course, { course_delivery: "unknown" }, constraint: "cohort_course_delivery_valid"
    assert_database_rejects course, { public_price_cents: 0 }, constraint: "cohort_public_price_positive"
    assert_database_rejects course, { self_paced_access_months: 0 }, constraint: "cohort_self_paced_terms_positive"
    assert_database_rejects course, { self_paced_support_weeks: 0 }, constraint: "cohort_self_paced_terms_positive"
  end

  test "submission window has positive week and one row per module cohort week" do
    lesson
    row = CohortModuleSubmissionWindow.create!(cohort: course, curriculum_module: mod, week_number: 1, submissions_close_at: 1.day.from_now)
    assert_database_rejects row, { week_number: 0 }, constraint: "submission_windows_week_number_positive"
    second = CurriculumModule.create!(curriculum: curriculum, name: "Other", position: 1)
    Lesson.create!(curriculum_module: second, title: "Other", position: 0, release_day: 0)
    other = CohortModuleSubmissionWindow.create!(cohort: course, curriculum_module: second, week_number: 1, submissions_close_at: 1.day.from_now)
    assert_database_rejects other, { module_id: mod.id }, ActiveRecord::RecordNotUnique, constraint: "idx_submission_windows_on_cohort_module_week"
  end

  test "module schedules are unique per module and cohort" do
    row = CohortModuleSchedule.create!(cohort: course, curriculum_module: mod, start_date: course.start_date)
    second = CurriculumModule.create!(curriculum: curriculum, name: "Other", position: 1)
    other = CohortModuleSchedule.create!(cohort: course, curriculum_module: second, start_date: course.start_date)
    assert_database_rejects other, { module_id: row.module_id }, ActiveRecord::RecordNotUnique, constraint: "index_cohort_module_schedules_on_cohort_id_and_module_id"
  end

  test "assistant token scope and digest are enforced in SQL and destroy detaches messages" do
    row, = AgentPostingToken.issue!(user: staff, name: "Synthetic")
    other, = AgentPostingToken.issue!(user: staff, name: "Other")
    assert_database_rejects row, { scope: "admin" }, constraint: "agent_posting_tokens_scope_valid"
    assert_database_rejects other, { token_digest: row.token_digest }, ActiveRecord::RecordNotUnique, constraint: "index_agent_posting_tokens_on_token_digest"
    sample_message.update!(agent_posting_token: row)
    row.destroy!
    assert_nil sample_message.reload.agent_posting_token_id
  end

  test "Clerk identities are unique by issuer subject and by user issuer" do
    row = ClerkIdentity.create!(user: student, issuer: "https://example.com/issuer", clerk_user_id: "synthetic")
    other = ClerkIdentity.create!(user: person, issuer: row.issuer, clerk_user_id: "other")
    assert_database_rejects other, { clerk_user_id: row.clerk_user_id }, ActiveRecord::RecordNotUnique, constraint: "index_clerk_identities_on_issuer_and_clerk_user_id"
    assert_database_rejects other, { user_id: row.user_id }, ActiveRecord::RecordNotUnique, constraint: "index_clerk_identities_on_user_id_and_issuer"
    row.touch_last_seen!
    seen = row.reload.last_seen_at
    travel 14.minutes
    row.touch_last_seen!
    assert_equal seen, row.reload.last_seen_at
    travel 1.minute
    row.touch_last_seen!
    assert_equal Time.current, row.reload.last_seen_at
  end

  test "learning objective positions and scoped codes are database constraints" do
    row = LearningObjective.create!(curriculum: curriculum, code: "FIRST", title: "First", success_criteria: "Demonstrated", position: 0)
    other = LearningObjective.create!(curriculum: curriculum, code: "SECOND", title: "Second", success_criteria: "Demonstrated", position: 1)
    assert_database_rejects row, { position: -1 }, constraint: "learning_objectives_position_nonnegative"
    assert_database_rejects other, { code: row.code }, ActiveRecord::RecordNotUnique, constraint: "index_learning_objectives_on_curriculum_id_and_code"
  end

  test "objective block alignment index rejects duplicate block objective" do
    objective = LearningObjective.create!(curriculum: curriculum, code: "FIRST", title: "First", success_criteria: "Demonstrated", position: 0)
    row = ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, content_block: block)
    second = lesson.content_blocks.create!(block_type: :exercise, position: 1)
    other = ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, content_block: second)
    assert_database_rejects other, { content_block_id: row.content_block_id }, ActiveRecord::RecordNotUnique, constraint: "idx_objective_alignments_unique_block"
  end

  test "channel and direct read states enforce membership uniqueness in SQL" do
    state = ChannelReadState.create!(channel: channel, user: student)
    other = ChannelReadState.create!(channel: channel, user: staff)
    assert_database_rejects other, { user_id: state.user_id }, ActiveRecord::RecordNotUnique, constraint: "index_channel_read_states_on_user_id_and_channel_id"
    member = conversation.direct_conversation_members.find_by!(user: staff)
    assert_database_rejects member, { user_id: student.id }, ActiveRecord::RecordNotUnique, constraint: "idx_direct_members_unique"
  end

  test "conversation member key uniqueness is scoped to workspace" do
    row = conversation
    other = DirectConversation.create!(workspace: course.workspace, member_key: "synthetic-other")
    assert_database_rejects other, { member_key: row.member_key }, ActiveRecord::RecordNotUnique, constraint: "index_direct_conversations_on_workspace_id_and_member_key"
  end

  test "learning plans enforce one plan per enrollment in SQL" do
    row = LearningPlan.create!(enrollment: enrollment, title: "First")
    other = LearningPlan.create!(enrollment: Enrollment.create!(user: person, cohort: course), title: "Other")
    assert_database_rejects other, { enrollment_id: row.enrollment_id }, ActiveRecord::RecordNotUnique, constraint: "index_learning_plans_on_enrollment_id"
  end

  test "private meeting slots reject overlaps and allow inactive history" do
    row = slot
    other = row.dup
    other.active = false
    other.save!
    assert_database_rejects other, { active: true }, ActiveRecord::ExclusionViolation, constraint: "private_meeting_slots_no_instructor_overlap"
    row.update!(active: false)
    other.update!(active: true)
    assert other.reload.active?
  end
end
