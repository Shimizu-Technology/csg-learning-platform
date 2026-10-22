require "test_helper"

# The same enrollment fixtures exercise support, cohort home and staff dashboard.
class AttentionProjectionTest < ActionDispatch::IntegrationTest
  def setup
    @now = Time.utc(2030, 7, 10, 2)
    travel_to @now
    @curriculum = Curriculum.create!(name: "Attention fixtures")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = @mod.lessons.create!(title: "Current work", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Work", submission_type: :text_submission)
    @future = @mod.lessons.create!(title: "Future work", position: 1, release_day: 30)
    @future.content_blocks.create!(block_type: :exercise, position: 0, title: "Later", submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Attention cohort", start_date: Date.new(2030, 7, 1), status: :active)
    @staff = User.create!(clerk_id: "attention_staff", email: "attention-staff@example.com", first_name: "Staff", role: :admin)
    @enrollment = learner("baseline")
  end

  def teardown
    travel_back
  end

  test "healthy learners, new invites and future releases do not create attention at any progress percentage" do
    Progress.create!(user: @enrollment.user, enrollment: @enrollment, content_block: @block, status: :completed, completed_at: @now - 10.days)
    fresh = learner("fresh", joined_at: nil, invited_at: @now - 1.day)
    fresh.user.update!(clerk_id: "pending_fresh", invite_delivery_status: "sent", invite_sent_at: @now - 1.day)
    future = learner("future")
    future.module_assignments.first.update!(unlock_date_override: Date.current + 7)
    paced = learner("paced")
    Progress.create!(user: paced.user, enrollment: paced, content_block: @block, status: :completed, completed_at: @now - 1.day)

    assert_empty projection[:students]
    assert_equal 4, projection.dig(:summary, :checked_enrollment_count)
    assert_equal 50.0, projection[:enrollments].find { |row| row[:enrollment_id] == @enrollment.id }[:progress_percentage]
  end

  test "released unfinished work and enrollment activity qualify inactivity without borrowing account sign-ins" do
    @enrollment.user.update!(last_seen_at: @now, last_sign_in_at: @now)
    row = attention_row
    assert row[:inactive]
    assert_equal [ "inactivity" ], row[:reasons].map { |reason| reason[:code] }
    assert_equal 1, row[:released_unfinished_blocks]
    assert_equal 2, row[:total_blocks]
    assert_includes row[:next_action][:web_path], "enrollment_id=#{@enrollment.id}"
    @enrollment.update!(joined_at: @now - 1.day)
    assert_empty projection[:students]
  end

  test "cohort learner activity counts but staff reviews and activity before enrollment do not" do
    ActivityEvent.record!(event_type: "submission_graded", actor: @staff, subject_user: @enrollment.user, cohort: @cohort)
    assert attention_row[:inactive]
    event = ActivityEvent.record!(event_type: "video_started", actor: @enrollment.user, cohort: @cohort)
    assert_empty projection[:students]
    event.update!(created_at: @enrollment.enrolled_at - 1.day)
    assert attention_row[:inactive]
  end

  test "lesson-only content uses the same denominator and release eligibility" do
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @future, unlock_date_override: Date.current + 1)
    row = projection[:enrollments].first
    assert_equal 1, row[:total_blocks]
    assert_equal 0, row[:released_unfinished_blocks]
    refute row[:needs_attention]
    @enrollment.lesson_assignments.first.update!(unlock_date_override: Date.current - 1)
    assert_equal [ "inactivity" ], attention_row[:reasons].map { |reason| reason[:code] }
  end

  test "Tuesday Thursday pacing and self-paced courses use real availability" do
    @enrollment.module_assignments.first.update!(unlock_date_override: Date.current + 1)
    @future.destroy!
    @lesson.update!(release_day: 1)
    @mod.update!(schedule_days: "tth")
    assert_empty projection[:students]
    @cohort.update!(course_delivery: :self_paced)
    assert_equal 1, attention_row[:released_unfinished_blocks]
  end

  test "a newer pass replaces a redo and a newer review replaces an old ungraded attempt per enrollment" do
    old = submission(grade: "R", graded_at: @now - 10.days)
    latest = submission(grade: "A", graded_at: @now)
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Same curriculum again", start_date: @cohort.start_date, status: :active)
    other = Enrollment.create!(user: @enrollment.user, cohort: other_cohort, joined_at: @now - 20.days, enrolled_at: @now - 20.days)
    other.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    pending = Submission.create!(enrollment: other, user: other.user, content_block: @block, text: "Other enrollment")
    assert_not_equal old.id, latest.id
    rows = projection[:enrollments].index_by { |row| row[:enrollment_id] }
    assert_equal 0, rows[@enrollment.id][:redo_count]
    assert_equal 0, rows[@enrollment.id][:ungraded_count]
    assert_equal 1, rows[other.id][:ungraded_count]
    assert_equal [ pending.id ], rows[other.id][:reasons].first[:source_ids]
    submission(grade: nil)
    assert_equal 1, attention_row[:ungraded_count]
  end

  test "attention uses the same attempt ordering as the grading authority for imported timestamps" do
    current = submission(grade: "A", created_at: @now - 1.hour)
    submission(grade: "R", created_at: @now - 10.days, graded_at: @now - 9.days)
    assert_equal current.id, current.latest_attempt.id
    assert_empty projection[:students]
    review = submission(grade: nil, created_at: @now)
    submission(grade: "A", created_at: @now - 5.days)
    assert_equal [ review.id ], attention_row[:reasons].first[:source_ids]
  end

  test "unassigned latest work still needs review without inflating the assigned denominator" do
    pending = submission(grade: nil, created_at: @now)
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @future, unlock_date_override: Date.current + 1)
    row = attention_row
    assert_equal [ "review" ], row[:reasons].map { |reason| reason[:code] }
    assert_equal [ pending.id ], row[:reasons].first[:source_ids]
    assert_equal 1, row[:total_blocks]
    assert_equal 0, row[:released_unfinished_blocks]
    pending.update!(grade: "R", graded_at: @now)
    assert_equal [ "waiting_on_learner" ], attention_row[:reasons].map { |reason| reason[:code] }
  end

  test "past and upcoming cohort rosters keep assigned progress without creating current attention" do
    Progress.create!(user: @enrollment.user, enrollment: @enrollment, content_block: @block, status: :completed, completed_at: @now)
    %i[upcoming completed].each do |status|
      @cohort.update!(status: status)
      home = CohortHomeProjection.new(cohort: @cohort, viewer: @staff).call
      row = home[:students].find { |student| student[:enrollment_id] == @enrollment.id }
      assert_equal 50.0, row[:progress_percentage]
      assert_equal 1, row[:completed_blocks]
      assert_equal 2, row[:total_blocks]
      refute row[:needs_attention]
      assert_empty home[:attention][:students]
    end
  end

  test "only due interventions and recovery plans produce attention and every due record is retained" do
    @enrollment.update!(joined_at: @now)
    intervention = Intervention.create!(trigger_type: :manual, enrollment: @enrollment, owner: @staff, created_by: @staff, next_follow_up_at: @now + 1.day)
    plan = RecoveryPlan.create!(source: :manual, enrollment: @enrollment, owner: @staff, created_by: @staff, target_pace: "One step", required_scope: "Current work", check_in_cadence: "Weekly", next_check_in_at: @now + 1.day)
    assert_empty projection[:students]
    intervention.update!(next_follow_up_at: @now - 1.day)
    plan.update!(next_check_in_at: @now - 1.hour)
    row = attention_row
    assert_equal %w[follow_up_due recovery_due], row[:reasons].map { |reason| reason[:code] }
    assert_equal [ intervention.id ], row[:reasons].first[:source_ids]
    assert_equal [ plan.id ], row[:reasons].last[:source_ids]
    assert_includes row[:next_action][:native_path], "/staff/intervention/#{intervention.id}"
  end

  test "invitation failure, expiry and not joined are distinguished from learning inactivity" do
    @enrollment.update!(joined_at: nil, invited_at: @now - 1.day)
    @enrollment.user.update!(clerk_id: "pending_baseline", invite_delivery_status: "failed")
    assert_equal [ "invitation_failed" ], attention_row[:reasons].map { |reason| reason[:code] }
    refute attention_row[:inactive]
    @enrollment.user.update!(invite_delivery_status: "sent", invite_sent_at: @now - 40.days)
    assert_equal [ "invitation_expired" ], attention_row[:reasons].map { |reason| reason[:code] }
    @enrollment.user.update!(clerk_id: "joined_account", invite_delivery_status: "accepted")
    @enrollment.update!(invited_at: @now - 8.days)
    assert_equal [ "invitation_not_joined" ], attention_row[:reasons].map { |reason| reason[:code] }
    @enrollment.update!(invited_at: @now - 1.day)
    assert_empty projection[:students]
  end

  test "zero assigned content needs admin setup only for joined learners" do
    @enrollment.module_assignments.destroy_all
    assert_equal [ "setup" ], attention_row[:reasons].map { |reason| reason[:code] }
    assert_includes attention_row[:next_action][:web_path], "/admin/students/#{@enrollment.user_id}?legacy=1&cohort_id=#{@cohort.id}"
    assert attention_row[:next_action][:web_handoff]
    @enrollment.update!(joined_at: nil, invited_at: @now)
    assert_empty projection[:students]
  end

  test "shared projections and dashboard expose identical enrollment reasons and exact primary destination" do
    request = HelpRequest.create!(student: @enrollment.user, cohort: @cohort, context_type: :lesson, context_id: @lesson.id, context_label: @lesson.title, context_path: "/lessons/#{@lesson.id}", category: :concept, message: "Help me continue")
    attempt = submission(grade: nil)
    expected = projection[:students]
    assert_equal %w[help_response review], expected.first[:reasons].map { |reason| reason[:code] }
    assert_equal [ request.id ], expected.first[:reasons].first[:source_ids]
    assert_equal [ attempt.id ], expected.first[:reasons].last[:source_ids]
    assert_equal expected, SupportQueueProjection.new(now: @now, cohort_ids: [ @cohort.id ]).call[:students]
    assert_equal expected, CohortHomeProjection.new(cohort: @cohort, viewer: @staff).call[:attention][:students]
    as_user(@staff) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: { "Authorization" => "Bearer test" } }
    assert_response :success
    dashboard = response.parsed_body.fetch("dashboard")
    assert_equal expected.as_json, dashboard.dig("attention", "students")
    assert_equal 1, dashboard.fetch("ungraded_count")
    assert_includes expected.first[:next_action][:web_path], "/admin/help-requests/#{request.id}?"
    assert_equal [], AttentionProjection.new(cohort_ids: []).call[:students]
  end

  test "urgent help sorts before normal help across enrollments then oldest waiting with stable ties" do
    normal = learner("aaa_normal")
    urgent_new = learner("bbb_urgent_new")
    urgent_old = learner("zzz_urgent_old")
    tied = learner("aaa_tied")
    request_for = ->(enrollment, urgency, age) do
      HelpRequest.create!(student: enrollment.user, cohort: @cohort, context_type: :lesson, context_id: urgency == :normal ? @future.id : @lesson.id,
        context_label: @lesson.title, context_path: "/lessons/#{@lesson.id}", category: :concept, message: "Help",
        urgency: urgency, created_at: @now - age)
    end
    request_for.call(normal, :normal, 5.days)
    request_for.call(urgent_new, :urgent, 1.hour)
    oldest = request_for.call(urgent_old, :urgent, 2.days)
    request_for.call(tied, :urgent, 2.days)
    request_for.call(urgent_old, :normal, 6.days)
    rows = projection[:students].select { |row| row[:help_request_count].positive? }
    assert_equal [ urgent_old.id, tied.id, urgent_new.id, normal.id ], rows.map { |row| row[:enrollment_id] }
    assert_includes rows.first[:reasons].first[:label], "Urgent help request"
    assert_includes rows.first[:next_action][:web_path], "/help-requests/#{oldest.id}?"
  end

  test "linked and standalone recovery actions reach exact plan controls and save check-ins" do
    [ false, true ].each do |linked|
      intervention = Intervention.create!(trigger_type: :manual, enrollment: @enrollment, owner: @staff, created_by: @staff, next_follow_up_at: @now + 1.day) if linked
      plan = RecoveryPlan.create!(source: :manual, enrollment: @enrollment, intervention: intervention, owner: @staff, created_by: @staff,
        target_pace: "One step", required_scope: "Work", check_in_cadence: "weekly", next_check_in_at: @now - 1.day)
      reason = attention_row[:reasons].find { |item| item[:code] == "recovery_due" }
      assert_includes reason[:action][:web_path], "/support?plan_id=#{plan.id}&"
      assert reason[:action][:web_handoff]
      as_user(@staff) do
        post "/api/v1/recovery_plans/#{plan.id}/check_ins", params: { check_in: { body: "Reviewed the next step" } }, headers: { "Authorization" => "Bearer test" }
      end
      assert_response :created
      assert_equal "Reviewed the next step", plan.check_ins.last.body
      refute attention_row[:recovery_check_in_due]
      plan.update!(status: :completed, outcome: "Returned to learning")
    end
  end

  test "real staff regrading does not reset learner inactivity" do
    @lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Next step")
    attempt = submission(grade: "R", graded_at: @now - 10.days, created_at: @now - 12.days)
    assert attention_row[:inactive]
    as_user(@staff) do
      patch "/api/v1/submissions/#{attempt.id}/grade", params: { grade: "A", feedback: "Passed", base_submission_updated_at: attempt.updated_at.iso8601(6) }, headers: { "Authorization" => "Bearer test" }
    end
    assert_response :success
    assert_equal @now, Progress.find_by!(enrollment: @enrollment, content_block: @block).completed_at
    row = attention_row
    assert row[:inactive]
    assert_equal 1, row[:released_unfinished_blocks]
    assert_equal attempt.created_at, row[:last_activity_at]
  end

  test "projection queries do not grow with learners including scheduled assignment modules" do
    @enrollment.module_assignments.first.update!(unlocked: false)
    @cohort.cohort_module_schedules.create!(curriculum_module: @mod, start_date: @cohort.start_date)
    count_queries = -> do
      count = 0
      callback = ->(_name, _start, _finish, _id, payload) { count += 1 unless payload[:name] == "SCHEMA" || payload[:cached] }
      ActiveRecord::Base.uncached { ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { projection } }
      count
    end
    projection
    baseline = count_queries.call
    5.times { |i| learner("growth_#{i}").module_assignments.first.update!(unlocked: false) }
    assert_operator count_queries.call, :<=, baseline + 1
  end

  private

  def learner(name, **attributes)
    user = User.create!(clerk_id: "attention_#{name}", email: "#{name}@attention.example", first_name: name, role: :student)
    enrollment = Enrollment.create!({ user: user, cohort: @cohort, joined_at: @now - 20.days, enrolled_at: @now - 20.days }.merge(attributes))
    enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    enrollment
  end

  def submission(**attributes)
    Submission.create!({ user: @enrollment.user, enrollment: @enrollment, content_block: @block, text: "Attempt", created_at: @now - 1.day }.merge(attributes))
  end

  def projection
    AttentionProjection.new(now: @now).call
  end

  def attention_row
    projection[:students].find { |row| row[:enrollment_id] == @enrollment.id }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
