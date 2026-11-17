require "test_helper"
require_relative "../support/course_package_fixture"

# The last L-5.2 record pages (a return plan, a community report, a course
# offering's purchases) and the rest of L-3.2's where-used relationships
# (person → reports and blocks, reported message → conversation, offering →
# purchases → enrollments, lesson → activity, course package → curriculum and
# cohorts). Return plans follow StaffCohortScope; reports, purchases and
# safety counts are admin-only. Everyone else gets the same 404 as a record
# that doesn't exist. All data is synthetic.
class ConnectedRecordsFinishTest < ActionDispatch::IntegrationTest
  include CoursePackageFixture

  setup do
    travel_to Time.zone.local(2026, 11, 18, 9, 0)
    @curriculum = Curriculum.create!(name: "Finish curriculum", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 1)
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Teal", start_date: Date.new(2026, 11, 2), status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Coral", start_date: Date.new(2026, 11, 2), status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @classmate = person("classmate", :student)
    @coral_student = person("coral", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = enroll(@student, @cohort)
    enroll(@classmate, @cohort)
    @coral_enrollment = enroll(@coral_student, @other_cohort)
  end

  # --- Return plan -------------------------------------------------------------

  test "a return plan shows its owner, scope, follow-up plan and newest check-ins for staff in its cohort" do
    intervention = Intervention.create!(enrollment: @enrollment, owner: @instructor, created_by: @admin, trigger_type: :manual, action_summary: "Synthetic", next_follow_up_at: 1.day.from_now)
    plan = recovery_plan(@enrollment, intervention: intervention)
    25.times { |i| plan.check_ins.create!(author: @instructor, body: "Check-in #{i}", next_check_in_at: (i + 1).days.from_now) }

    [ @admin, @instructor ].each do |viewer|
      detail = fetch(viewer, "recovery_plan", plan.id)
      assert_response :success
      assert_equal [ "recovery_plan", "active", "Cohort Teal", @student.id, @instructor.id, true ],
        [ detail["type"], detail["status"], detail.dig("cohort", "name"), detail.dig("student", "id"), detail.dig("owner", "id"), detail.dig("owner", "valid") ]
      assert_equal "Two lessons a day", detail["target_pace"]
      assert_equal intervention.id, detail.dig("follow_up", "id")
      assert_equal 25, detail["check_ins_count"]
      assert_equal 20, detail["check_ins"].size, "The newest twenty are listed"
      assert_equal "Check-in 24", detail["check_ins"].first["body"], "Newest first"
      assert detail["can_edit"]
    end

    [ @outsider, @student ].each do |viewer|
      fetch(viewer, "recovery_plan", plan.id)
      assert_response :not_found
      refute_includes response.body, "Cohort Teal"
    end
    fetch(@admin, "recovery_plan", 999_999)
    assert_response :not_found
  end

  # --- Community report ----------------------------------------------------------

  test "a community report quotes the message, links a class channel and shows both people's safety counts" do
    channel = @cohort.channels.find_by!(name: "Class Chat")
    message = Message.create!(channel: channel, author: @classmate, body: "Channel post")
    report = ContentReport.create!(reporter: @student, reported_user: @classmate, message: message, reason: :spam, details: "Spam links")
    older = ContentReport.create!(reporter: @coral_student, reported_user: @classmate, reason: :harassment)
    UserBlock.create!(blocker: @student, blocked_user: @classmate)

    detail = fetch(@admin, "content_report", report.id)
    assert_response :success
    assert_equal [ "content_report", "spam", "pending", @student.id, @classmate.id ],
      [ detail["type"], detail["reason"], detail["status"], detail.dig("reporter", "id"), detail.dig("reported_user", "id") ]
    assert_equal "Channel post", detail.dig("message", "body")
    conversation = detail.dig("message", "conversation")
    assert conversation["available"]
    assert_equal "/messages/#{channel.id}?message_id=#{message.id}", RecordDestination.to_web_path(conversation["destination"])
    assert_equal [ older.id ], detail["other_reports"].map { |row| row["id"] }
    assert_equal 1, detail["other_reports_count"]
    assert_equal [ [ @student.id, @classmate.id ] ], detail["blocks_between"].map { |row| row.values_at("blocker_id", "blocked_user_id") }
    assert_equal({ "reports_about" => 2, "open_reports_about" => 2, "reports_by" => 0, "blocks_made" => 0, "blocked_by" => 1 }, detail["reported_user_safety"])
    assert_equal({ "reports_about" => 0, "open_reports_about" => 0, "reports_by" => 1, "blocks_made" => 1, "blocked_by" => 0 }, detail["reporter_safety"])
  end

  test "a reported direct message stays a quote and a label for an admin outside the conversation" do
    dm = DirectConversation.find_or_create_for!(workspace: Workspace.find_or_create_for_cohort!(@cohort), users: [ @student, @classmate ])
    message = Message.create!(direct_conversation: dm, author: @classmate, body: "Private note")
    report = ContentReport.create!(reporter: @student, reported_user: @classmate, message: message, reason: :harassment)

    detail = fetch(@admin, "content_report", report.id)
    conversation = detail.dig("message", "conversation")
    assert_equal [ "dm", false, nil ], conversation.values_at("kind", "available", "destination")
    assert_equal "Direct conversation in Cohort Teal", conversation["label"]
  end

  test "a community report is a 404 for instructors, even in the reported person's cohort, and for students" do
    report = ContentReport.create!(reporter: @student, reported_user: @classmate, reason: :other)
    [ @instructor, @student, @classmate ].each do |viewer|
      fetch(viewer, "content_report", report.id)
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
  end

  # --- Person → reports and blocks ---------------------------------------------

  test "Safety lists filter to one person, and an unknown person lists nothing" do
    about = ContentReport.create!(reporter: @student, reported_user: @classmate, reason: :spam)
    by = ContentReport.create!(reporter: @classmate, reported_user: @coral_student, reason: :other)
    ContentReport.create!(reporter: @student, reported_user: @coral_student, reason: :other)
    made = UserBlock.create!(blocker: @classmate, blocked_user: @student)
    UserBlock.create!(blocker: @coral_student, blocked_user: @student)

    as_user(@admin) { get "/api/v1/content_reports", params: { view: "open", user_id: @classmate.id }, headers: auth_headers }
    assert_response :success
    assert_equal [ about.id, by.id ].sort, response.parsed_body["content_reports"].map { |row| row["id"] }.sort
    assert_equal({ "id" => @classmate.id, "full_name" => @classmate.full_name }, response.parsed_body["person"])
    as_user(@admin) { get "/api/v1/safety/user_blocks", params: { user_id: @classmate.id }, headers: auth_headers }
    assert_equal [ made.id ], response.parsed_body["user_blocks"].map { |row| row["id"] }
    assert_equal @classmate.id, response.parsed_body.dig("person", "id")

    [ "999999", "abc" ].each do |id|
      as_user(@admin) { get "/api/v1/content_reports", params: { view: "open", user_id: id }, headers: auth_headers }
      assert_empty response.parsed_body["content_reports"]
      assert_nil response.parsed_body["person"]
      as_user(@admin) { get "/api/v1/safety/user_blocks", params: { user_id: id }, headers: auth_headers }
      assert_empty response.parsed_body["user_blocks"]
    end
    as_user(@admin) { get "/api/v1/safety/user_blocks", headers: auth_headers }
    assert_equal 2, response.parsed_body["user_blocks"].size, "Unfiltered lists are unchanged"
  end

  test "a student's related panel shows safety counts to admins and never to instructors" do
    ContentReport.create!(reporter: @classmate, reported_user: @student, reason: :spam)
    UserBlock.create!(blocker: @student, blocked_user: @classmate)

    related = related_items(@admin, @student, @cohort)
    safety = related.fetch("safety")
    assert_equal [ 1, 1, 0, 1, 0 ], safety.values_at("count", "reports_about", "reports_by", "blocks_made", "blocked_by")
    assert_not related_items(@instructor, @student, @cohort).key?("safety"), "Instructors never see safety counts"
  end

  # --- Offering → purchases → enrollments -------------------------------------

  test "an offering lists its purchases newest first on a fixed cursor, with each buyer's enrollment" do
    offering = Cohort.create!(curriculum: @curriculum, name: "Self-paced JS", start_date: Date.new(2026, 11, 1), status: :active, course_delivery: "self_paced",
      public_checkout_enabled: true, public_price_cents: 14_900, public_slug: "self-paced-js")
    buyers = Array.new(30) { |i| person("buyer#{i}", :student) }
    purchases = buyers.each_with_index.map do |buyer, i|
      CoursePurchase.create!(user: buyer, cohort: offering, stripe_price_id: "price_synthetic", price_cents: 14_900, status: i < 27 ? "paid" : "pending")
    end
    buyers.first(27).each { |buyer| enroll(buyer, offering) }

    first = fetch(@admin, "offering", offering.id)
    assert_response :success
    assert_equal [ "offering", 30, 27, 3, 27 * 14_900, 27 ], [ first["type"], first["purchases_count"], first.dig("status_counts", "paid"), first.dig("status_counts", "pending"), first["paid_cents"], first["enrolled_count"] ]
    assert_equal purchases.last.id, first["purchases"].first["id"], "Newest first"
    assert_equal 25, first["purchases"].size
    assert_nil first["purchases"].first["enrollment"], "A pending checkout has no enrollment yet"
    assert_equal "active", first["purchases"].last.dig("enrollment", "status")

    # A purchase changing status between pages is still listed once.
    purchases.first.update!(status: "refunded")
    rest = fetch(@admin, "offering", offering.id, purchases_before: first["purchases_next_before"])
    ids = (first["purchases"] + rest["purchases"]).map { |row| row["id"] }
    assert_equal purchases.map(&:id).sort, ids.sort
    assert_equal 30, ids.uniq.size
    assert_nil rest["purchases_next_before"]

    [ @instructor, @student ].each do |viewer|
      fetch(viewer, "offering", offering.id)
      assert_response :not_found
    end
    fetch(@admin, "offering", @cohort.id)
    assert_response :not_found, "A live program has no offering page"
  end

  test "a self-paced cohort's related panel counts paid purchases for admins only" do
    offering = Cohort.create!(curriculum: @curriculum, name: "Self-paced JS", start_date: Date.new(2026, 11, 1), status: :active, course_delivery: "self_paced")
    offering.cohort_instructor_assignments.create!(user: @instructor)
    CoursePurchase.create!(user: @student, cohort: offering, stripe_price_id: "price_synthetic", status: "paid")
    CoursePurchase.create!(user: @classmate, cohort: offering, stripe_price_id: "price_synthetic", status: "pending")

    as_user(@admin) { get "/api/v1/records/cohort/#{offering.id}/related", headers: auth_headers }
    assert_equal 1, response.parsed_body.dig("related", "items").find { |item| item["key"] == "purchases" }&.fetch("count")
    as_user(@instructor) { get "/api/v1/records/cohort/#{offering.id}/related", headers: auth_headers }
    assert_nil response.parsed_body.dig("related", "items").find { |item| item["key"] == "purchases" }
  end

  # --- Lesson → activity -----------------------------------------------------------

  test "a lesson's activity lists only events that pass the event page's own check" do
    work = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, submission_type: :text_submission, text: "Synthetic")
    coral_work = Submission.create!(user: @coral_student, enrollment: @coral_enrollment, content_block: @exercise, submission_type: :text_submission, text: "Synthetic")
    shown = [
      ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: @cohort, record: @exercise),
      ActivityEvent.record!(event_type: "submission_graded", actor: @instructor, subject_user: @student, cohort: @cohort, record: work)
    ]
    coral = ActivityEvent.record!(event_type: "submission_created", actor: @coral_student, cohort: @other_cohort, record: coral_work)
    # Each of these names someone or something outside its cohort.
    ActivityEvent.record!(event_type: "checkpoint_completed", actor: @coral_student, cohort: @cohort, record: @exercise)
    ActivityEvent.record!(event_type: "submission_graded", actor: @outsider, subject_user: @student, cohort: @cohort, record: work)
    ActivityEvent.record!(event_type: "submission_created", actor: @classmate, cohort: @cohort, record: work)
    ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: coral_work)

    usage = usage(@instructor, @lesson)
    assert_equal 2, usage.dig("activity", "count")
    assert_equal shown.reverse.map(&:id), usage.dig("activity", "recent").map { |row| row["id"] }
    refute_includes response.body, @coral_student.full_name
    refute_includes response.body, @outsider.full_name

    admin = usage(@admin, @lesson)
    assert_equal (shown + [ coral ]).map(&:id).sort, admin.dig("activity", "recent").map { |row| row["id"] }.sort, "Admins see every cohort's activity"
  end

  # --- Course package → curriculum and cohorts ------------------------------------

  test "a package preview names the curriculum it updates and the cohorts and offerings using it" do
    package = self.package
    as_user(@admin) { post "/api/v1/course_packages/preview", params: { package: package }, headers: auth_headers, as: :json }
    assert_equal [ nil, [] ], response.parsed_body["preview"].values_at("curriculum", "cohorts")

    curriculum = Curriculum.find(CoursePackageImporter.new(package).call[:curriculum_id])
    Cohort.create!(curriculum: curriculum, name: "Package program", start_date: Date.new(2026, 11, 1), status: :active)
    Cohort.create!(curriculum: curriculum, name: "Package on sale", start_date: Date.new(2026, 11, 2), status: :active, course_delivery: "self_paced", public_checkout_enabled: true)
    as_user(@admin) { post "/api/v1/course_packages/preview", params: { package: package }, headers: auth_headers, as: :json }
    preview = response.parsed_body["preview"]
    assert_equal curriculum.id, preview.dig("curriculum", "id")
    assert_equal [ [ "Package program", false ], [ "Package on sale", true ] ], preview["cohorts"].map { |row| row.values_at("name", "on_sale") }
  end

  private

  def person(name, role)
    User.create!(clerk_id: "finish_#{name}", email: "finish-#{name}@example.invalid", first_name: "Finish", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def recovery_plan(enrollment, intervention: nil)
    RecoveryPlan.create!(enrollment: enrollment, source: :manual, status: :active, owner: @instructor, created_by: @instructor, intervention: intervention,
      target_pace: "Two lessons a day", required_scope: "Week 2 exercises", check_in_cadence: "weekly", next_check_in_at: 2.days.from_now)
  end

  def related_items(viewer, student, cohort)
    as_user(viewer) { get "/api/v1/records/student/#{student.id}/related", params: { cohort_id: cohort.id }, headers: auth_headers }
    assert_response :success
    response.parsed_body.dig("related", "items").index_by { |item| item["key"] }
  end

  def usage(viewer, lesson)
    as_user(viewer) { get "/api/v1/records/lesson/#{lesson.id}/usage", headers: auth_headers }
    assert_response :success
    response.parsed_body["usage"]
  end

  def fetch(viewer, type, id, **params)
    as_user(viewer) { get "/api/v1/records/#{type}/#{id}/detail", params: params, headers: auth_headers }
    response.parsed_body["detail"]
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
