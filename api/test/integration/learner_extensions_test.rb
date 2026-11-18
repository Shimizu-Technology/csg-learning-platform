require "test_helper"
require_relative "../support/query_counter"

class LearnerExtensionsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  module BeforeWriteGuard
    mattr_accessor :callback, :lock_callback
    def with_lock(...)
      callback = BeforeWriteGuard.lock_callback
      BeforeWriteGuard.lock_callback = nil
      callback&.call
      super
    end

    def with_learning_write_guard(**options, &block)
      callback = BeforeWriteGuard.callback
      BeforeWriteGuard.callback = nil
      callback&.call
      super
    end
  end
  Enrollment.prepend(BeforeWriteGuard) unless Enrollment.ancestors.include?(BeforeWriteGuard)
  teardown { BeforeWriteGuard.callback = nil; BeforeWriteGuard.lock_callback = nil }
  setup do
    curriculum = Curriculum.create!(name: "Extensions")
    @mod = curriculum.modules.create!(name: "Module", position: 0, day_offset: 0)
    @lesson = @mod.lessons.create!(title: "Work", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Answer", submission_type: "text_submission")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Program", start_date: 2.weeks.ago.to_date)
    @teacher = person("teacher", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("student", :student)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.day.ago)
    @path = "/api/v1/enrollments/#{@enrollment.id}/extensions"
  end

  test "grant, change and removal enforce effective window and retain history" do
    submit
    assert_response :forbidden
    grant
    assert_response :success
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    get @path, headers: headers(@teacher)
    assert_response :success
    submit
    assert_response :success
    patch "#{@path}/#{id}", params: input.merge(reason: "Changed"), headers: headers(@teacher), as: :json
    assert_response :success
    delete "#{@path}/#{id}", params: { reason: "No longer needed" }, headers: headers(@teacher), as: :json
    assert_response :success
    assert_equal 3, response.parsed_body.fetch("extensions").first.fetch("revisions").size
    submit
    assert_response :forbidden
  end

  test "reason required and unauthorized reads and writes are uniformly not found" do
    post @path, params: input.merge(reason: " "), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    [ @student, person("outsider", :instructor) ].each do |actor|
      post @path, params: input, headers: headers(actor), as: :json
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
      get @path, headers: headers(actor)
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
  end

  test "unknown grants are not found and invalid changes preserve history" do
    patch "#{@path}/99999999", params: input, headers: headers(@teacher), as: :json
    assert_response :not_found
    delete "#{@path}/99999999", params: { reason: "Missing" }, headers: headers(@teacher), as: :json
    assert_response :not_found
    grant
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    patch "#{@path}/#{id}", params: input.merge(reason: ""), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    delete "#{@path}/#{id}", params: { reason: "" }, headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_equal 1, LearnerExtension.find(id).revisions.size
    assert_nil LearnerExtension.find(id).removed_at
  end

  test "program effective windows are byte identical without grants" do
    original = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson)
    assert_equal original.to_json, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment).to_json
    grant
    other = Enrollment.create!(cohort: @cohort, user: person("other", :student), status: :active)
    assert_equal original.to_json, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: other).to_json
  end

  test "queue and workspace queries stay flat as extension fixtures grow" do
    grant
    submit
    row = GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json.fetch(:submissions).first
    assert_equal "Travel", row.fetch(:extensions).first.fetch("reason")
    assert_not row.fetch(:submission_window).fetch(:submissions_closed)
    measure = lambda do
      queue = count_queries { GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json }
      workspace = count_queries { get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher) }
      assert_response :success
      [ queue, workspace ]
    end
    measure.call
    one = measure.call
    4.times do |index|
      student = person("more#{index}", :student)
      enrollment = Enrollment.create!(cohort: @cohort, user: student, status: :active)
      enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
      enrollment.learner_extensions.new(scope: "lesson", lesson: @lesson, submissions_close_at: 2.days.from_now, reason: "Travel").record_change!(actor: @teacher)
      Submission.create!(user: student, enrollment: enrollment, content_block: @block, text: "Answer", submission_type: "text_submission")
      @enrollment.learner_extensions.new(scope: "lesson", lesson: @lesson, submissions_close_at: (index + 3).days.from_now, reason: "Additional").record_change!(actor: @teacher)
    end
    assert_equal one, measure.call
  end

  test "final extensions shift future milestones, survive replanning, and retain both histories" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    @lesson.update!(lesson_type: :project)
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    target = 8.weeks.from_now.in_time_zone("Pacific/Guam").end_of_day
    post @path, params: { scope: "final", submissions_close_at: target.iso8601, reason: "Medical leave" }, headers: headers(@teacher), as: :json
    assert_response :success
    plan = @enrollment.learning_plan.reload
    assert_equal target.to_date, plan.target_date
    assert plan.revisions.count >= 2
    LearnerPace.new(@enrollment.reload).choose!(weeks: 12, actor: @teacher)
    replanned = @enrollment.learning_plan.reload
    assert_operator replanned.target_date, :>, target.to_date
    assert replanned.milestones.all? { |item| Date.iso8601(item.fetch("due_on")) >= LearningCalendar.today }
    assert_equal replanned.target_date, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_close_at].in_time_zone("Pacific/Guam").to_date
    assert_equal "Medical leave", @enrollment.learner_extensions.first.reason
    travel_to(replanned.target_date.in_time_zone("Pacific/Guam").end_of_day + 1.second) do
      submit
      assert_response :forbidden
    end
  end

  test "a module-week grant affects only that module week" do
    post @path, params: input.except(:lesson_id).merge(scope: "module", module_id: @mod.id, week_number: 1), headers: headers(@teacher), as: :json
    assert_response :success
    assert_not SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_closed]
    second = @mod.lessons.create!(title: "Week two", position: 1, release_day: 7)
    original = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: second)
    assert_equal original, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: second, enrollment: @enrollment.reload)
  end

  test "weekly pace milestones remain soft even after cohort windows close" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    assert_not SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_closed]
    submit
    assert_response :success
  end

  test "cohort postponement wins over a previously longer grant" do
    grant
    assert_response :success
    @cohort.cohort_module_submission_windows.first.update!(submissions_close_at: 4.days.from_now)
    peer = person("peer", :student)
    peer_enrollment = Enrollment.create!(cohort: @cohort, user: peer, status: :active)
    peer_enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    travel 3.days do
      [ @student, peer ].each do |student|
        post "/api/v1/submissions", params: { content_block_id: @block.id, cohort_id: @cohort.id, text: "In time" }, headers: headers(student), as: :json
        assert_response :created
      end
    end
  end

  test "creates and edits may not shorten the learner's own finite window" do
    @cohort.cohort_module_submission_windows.first.update!(submissions_close_at: 2.days.from_now)
    post @path, params: input.merge(submissions_close_at: 4.days.from_now.iso8601), headers: headers(@teacher), as: :json
    assert_response :success
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    patch "#{@path}/#{id}", params: input.merge(submissions_close_at: 1.day.from_now.iso8601), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    patch "#{@path}/#{id}", params: { submissions_close_at: 5.days.from_now.iso8601 }, headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_equal 1, LearnerExtension.find(id).revisions.size
  end

  test "an unrestricted base stays open and rejects new hard cutoffs" do
    @cohort.cohort_module_submission_windows.destroy_all
    grant
    assert_response :unprocessable_entity
    legacy_grant
    submit
    assert_response :created
    assert_nil effective_window[:submissions_close_at]
  end

  test "a soft pace week stays open even with a legacy grant and cohort close" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    grant
    assert_response :unprocessable_entity
    legacy_grant
    assert_nil effective_window[:submissions_close_at]
    submit
    assert_response :created
  end

  test "lesson and module grants compare against a final project's personal date" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    @lesson.update!(lesson_type: :project)
    plan = LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    close_at = (plan.target_date - 1).in_time_zone("Pacific/Guam").end_of_day.iso8601
    [ { scope: "lesson", lesson_id: @lesson.id }, { scope: "module", module_id: @mod.id, week_number: 1 } ].each do |scope|
      post @path, params: scope.merge(reason: "Cannot shorten", submissions_close_at: close_at), headers: headers(@teacher), as: :json
      assert_response :unprocessable_entity
    end
  end

  test "removal remains possible after target unassignment or pace switch off" do
    grant
    assert_response :success
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    @enrollment.module_assignments.destroy_all
    delete "#{@path}/#{id}", params: { reason: "No longer assigned" }, headers: headers(@teacher), as: :json
    assert_response :success
    assert LearnerExtension.find(id).removed_at
  end

  test "final grants shift only future milestones forward and earlier edits are refused" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    @lesson.update!(lesson_type: :project)
    past = @mod.lessons.create!(title: "Finished earlier", position: 1, release_day: 0)
    past.content_blocks.create!(title: "Read", block_type: :text, position: 0)
    plan = LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    plan.update!(milestones: [ { "title" => "Past", "due_on" => 1.day.ago.to_date.iso8601, "lesson_ids" => [ past.id ] },
      { "title" => "Final project", "due_on" => plan.target_date.iso8601, "lesson_ids" => [ @lesson.id ] } ])
    original = plan.milestones.deep_dup
    old_target = plan.target_date
    target = (old_target + 21).in_time_zone("Pacific/Guam").end_of_day
    post @path, params: { scope: "final", submissions_close_at: target.iso8601, reason: "More time" }, headers: headers(@teacher), as: :json
    assert_response :success
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    moved = plan.reload.milestones
    assert_equal original.first, moved.first
    assert_equal (Date.iso8601(original.last.fetch("due_on")) + 21).iso8601, moved.last.fetch("due_on")
    patch "#{@path}/#{id}", params: { submissions_close_at: (target - 7.days).iso8601, reason: "Earlier correction" }, headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_equal moved, plan.reload.milestones
  end

  test "completion rechecks an extension removed before the write lock" do
    @block.update!(submission_type: :manual_complete)
    grant
    extension = @enrollment.learner_extensions.last
    BeforeWriteGuard.callback = -> { extension.record_change!(actor: @teacher, removing: true) }
    patch "/api/v1/progress", params: { content_block_id: @block.id, cohort_id: @cohort.id, status: "completed" }, headers: headers(@student), as: :json
    assert_response :forbidden
    assert_not Progress.exists?(enrollment: @enrollment, content_block: @block, status: :completed)
  end

  test "submit and resubmit recheck an extension removed before the write lock" do
    grant
    extension = @enrollment.learner_extensions.last
    BeforeWriteGuard.callback = -> { extension.record_change!(actor: @teacher, removing: true) }
    submit
    assert_response :forbidden
    assert_not Submission.exists?(enrollment: @enrollment, content_block: @block)
    grant
    assert_response :success
    submit
    assert_response :success
    submission = response.parsed_body.fetch("submission")
    extension = @enrollment.learner_extensions.order(:id).last
    BeforeWriteGuard.callback = -> { extension.record_change!(actor: @teacher, removing: true) }
    patch "/api/v1/submissions/#{submission.fetch('id')}", params: { text: "Changed", cohort_id: @cohort.id, base_updated_at: submission.fetch("updated_at") }, headers: headers(@student), as: :json
    assert_response :forbidden
    assert_equal "Answer", Submission.find(submission.fetch("id")).text
  end

  test "GitHub sync rechecks windows after the network request" do
    @student.update!(github_username: "synthetic")
    @block.update!(filename: "answer.rb", submission_type: :prework_github_sync)
    grant
    extension = @enrollment.learner_extensions.last
    teacher = @teacher
    service = GithubSyncService.new(github_token: "test-token")
    service.define_singleton_method(:fetch_exercise_files) do |*|
      extension.record_change!(actor: teacher, removing: true)
      { files: [ { "name" => "answer.rb", "text" => "puts 'hello'" } ], commit_hash: "abc", error: nil }
    end
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 0, result[:synced]
    assert_includes result[:errors], "Skipped closed Week 1 GitHub-sync submissions"
    assert_not Submission.exists?(enrollment: @enrollment, content_block: @block)
  end

  test "a reason-only edit cannot restore a grant removed while waiting for the enrollment lock" do
    grant
    extension = @enrollment.learner_extensions.first
    BeforeWriteGuard.lock_callback = -> { extension.record_change!(actor: @teacher, removing: true) }
    # The controller may have loaded the grant before the removal; lock! must
    # re-read and reject it rather than clearing removed_at.
    patch "#{@path}/#{extension.id}", params: { reason: "Stale correction" }, headers: headers(@teacher), as: :json
    assert_response :not_found
    assert extension.reload.removed_at
    assert_equal 2, extension.revisions.size
    assert_equal "Travel", extension.reason
    submit
    assert_response :forbidden
  end

  test "impossible calendar dates are rejected rather than normalized" do
    post @path, params: input.merge(submissions_close_at: "2027-02-30T12:00:00Z"), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_empty @enrollment.learner_extensions
  end

  test "removing a final grant reconciles a paused learner plan before resume" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 6 ])
    @lesson.update!(lesson_type: :project)
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    original = @enrollment.learning_plan.reload.target_date
    deadline = 8.weeks.from_now.in_time_zone("Pacific/Guam").end_of_day
    post @path, params: { scope: "final", submissions_close_at: deadline.iso8601, reason: "Leave" }, headers: headers(@teacher), as: :json
    assert_response :success
    extension = @enrollment.learner_extensions.reload.first
    @enrollment.update!(status: :paused)
    delete "#{@path}/#{extension.id}", params: { reason: "Leave ended" }, headers: headers(@teacher), as: :json
    assert_response :success
    assert_equal original, @enrollment.learning_plan.reload.target_date
    assert @enrollment.reload.paused?
    @enrollment.update!(status: :active)
    assert_equal original, effective_window.fetch(:submissions_close_at).in_time_zone("Pacific/Guam").to_date
  end

  test "disabled learning plans use the cohort window for display and enforcement" do
    @enrollment.update!(first_opened_at: 2.weeks.ago)
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 6 ])
    @lesson.update!(lesson_type: :project)
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    @enrollment.learning_plan.update!(target_date: 1.day.ago.to_date, milestones: [])
    @cohort.cohort_module_submission_windows.first.update!(submissions_close_at: 2.days.from_now)
    @cohort.update!(settings: { "features" => { "learning_plans" => false } })
    assert_not effective_window.fetch(:submissions_closed)
    get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    assert_not response.parsed_body.fetch("lesson").fetch("submission_window").fetch("submissions_closed")
    submit
    assert_response :created
    @cohort.update!(settings: { "features" => { "learning_plans" => true } })
    assert effective_window.fetch(:submissions_closed)
    submit
    assert_response :forbidden
  end

  test "final grants accept only Guam end-of-day calendar cutoffs" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 6 ])
    @lesson.update!(lesson_type: :project)
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    post @path, params: { scope: "final", submissions_close_at: 8.weeks.from_now.change(hour: 2).iso8601, reason: "Leave" }, headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_includes response.parsed_body.fetch("errors").join, "end of day"
  end

  test "hard deletion nullifies a lesson target while retaining its grant history" do
    grant
    extension = @enrollment.learner_extensions.first
    @lesson.destroy!
    assert_nil extension.reload.lesson_id
    assert_equal @lesson.id, extension.revisions.first.fetch("lesson_id")
    assert_equal "Travel", extension.reason
  end

  test "deleted lesson grants do not enable deadline UI or affect another lesson's window and remain removable" do
    other = @mod.lessons.create!(title: "Unrelated work", position: 1, release_day: 0)
    block = other.content_blocks.create!(block_type: :exercise, position: 0, title: "Answer", submission_type: :text_submission)
    grant
    extension = @enrollment.learner_extensions.first
    assert extension.effective?
    @lesson.destroy!
    assert_not extension.reload.effective?
    context = SubmissionWindowContext.new(@enrollment.reload)
    assert_empty context.matching_extensions(other)
    assert_equal @cohort.cohort_module_submission_windows.first.submissions_close_at, context.close_at(other)
    get "/api/v1/lessons/#{other.id}", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    assert_not response.parsed_body.fetch("lesson").key?("show_personal_deadline")
    post "/api/v1/submissions", params: { content_block_id: block.id, cohort_id: @cohort.id, text: "Answer" }, headers: headers(@student), as: :json
    assert_response :forbidden
    Submission.create!(enrollment: @enrollment, user: @student, content_block: block, text: "Earlier work", submission_type: :text_submission)
    row = GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json.fetch(:submissions).first
    assert_not row.key?(:extensions)
    assert_not row.key?(:submission_window)
    delete "#{@path}/#{extension.id}", params: { reason: "Lesson no longer exists" }, headers: headers(@teacher), as: :json
    assert_response :success
    assert extension.reload.removed_at
    assert_equal @lesson.id, extension.revisions.first.fetch("lesson_id")
    assert_equal 2, extension.revisions.size
  end

  test "a lesson moved to another released closed week is refused after locking" do
    @mod.lessons.create!(title: "Week two", position: 1, release_day: 7)
    @cohort.cohort_module_submission_windows.first.update!(submissions_close_at: 2.days.from_now)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 2, submissions_close_at: 1.day.ago)
    BeforeWriteGuard.callback = -> { @lesson.update!(release_day: 7) }
    submit
    assert_response :forbidden
    assert_empty Submission.where(enrollment: @enrollment)
  end

  test "GitHub sync uses the current lesson after a released week move during fetch" do
    @mod.lessons.create!(title: "Week two", position: 1, release_day: 7)
    @cohort.cohort_module_submission_windows.first.update!(submissions_close_at: 2.days.from_now)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 2, submissions_close_at: 1.day.ago)
    @student.update!(github_username: "synthetic")
    @block.update!(filename: "answer.rb", submission_type: :prework_github_sync)
    lesson_id = @lesson.id
    service = GithubSyncService.new(github_token: "test-token")
    service.define_singleton_method(:fetch_exercise_files) do |*|
      Lesson.find(lesson_id).update!(release_day: 7)
      { files: [ { "name" => "answer.rb", "text" => "puts 'hello'" } ], commit_hash: "abc", error: nil }
    end
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 0, result[:synced]
    assert_includes result[:errors], "Skipped closed Week 2 GitHub-sync submissions"
    assert_empty Submission.where(enrollment: @enrollment)
  end

  test "GitHub sync uses current cohort pace settings after fetching" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 6 ])
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    @student.update!(github_username: "synthetic")
    @block.update!(filename: "answer.rb", submission_type: :prework_github_sync)
    cohort_id = @cohort.id
    service = GithubSyncService.new(github_token: "test-token")
    service.define_singleton_method(:fetch_exercise_files) do |*|
      Cohort.find(cohort_id).update!(learner_pace_weeks: nil)
      { files: [ { "name" => "answer.rb", "text" => "puts 'hello'" } ], commit_hash: "abc", error: nil }
    end
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 0, result[:synced]
    assert_includes result[:errors], "Skipped closed Week 1 GitHub-sync submissions"
    assert_empty Submission.where(enrollment: @enrollment)
  end

  test "grading reasons include only grants matching the submitted lesson or week" do
    grant
    another = @mod.lessons.create!(title: "Other week", position: 1, release_day: 7)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 2, submissions_close_at: 1.day.ago)
    @enrollment.learner_extensions.new(scope: "module", module_id: @mod.id, week_number: 2, reason: "Other week leave", submissions_close_at: 3.days.from_now).record_change!(actor: @teacher)
    submit
    assert_response :created
    row = GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json.fetch(:submissions).first
    assert_equal [ "Travel" ], row.fetch(:extensions).map { |item| item.fetch("reason") }
  end

  def effective_window
    SubmissionWindowStatus.for_lesson(cohort: @cohort.reload, lesson: @lesson, enrollment: @enrollment.reload)
  end

  def legacy_grant
    @enrollment.learner_extensions.new(scope: "lesson", lesson: @lesson, reason: "Legacy", submissions_close_at: 1.day.ago,
      granted_by: @teacher, granted_at: 2.days.ago).save!(validate: false)
  end

  private

  def person(name, role)
    user = User.create!(clerk_id: "extensions_#{name}", email: "extensions_#{name}@example.com", role: role)
    user.clerk_identities.create!(issuer: ClerkEnvironment.primary&.issuer || "https://test.clerk.invalid", clerk_user_id: user.clerk_id)
    user
  end
  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
  def input = { scope: "lesson", lesson_id: @lesson.id, submissions_close_at: 2.days.from_now.iso8601, reason: "Travel" }
  def grant = post(@path, params: input, headers: headers(@teacher), as: :json)
  def submit = post("/api/v1/submissions", params: { content_block_id: @block.id, cohort_id: @cohort.id, text: "Answer" }, headers: headers(@student), as: :json)
end
