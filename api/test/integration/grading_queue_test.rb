require "test_helper"
require_relative "../support/curriculum_copy_fixture"

# GET /api/v1/grading_queue: the Grading workbench's paged queue (W7 PR 7.3 fix round 1).
class GradingQueueTest < ActionDispatch::IntegrationTest
  include CurriculumCopyFixture

  setup do
    @curriculum = Curriculum.create!(name: "Queue curriculum")
    @js = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript", position: 1, day_offset: 0, schedule_days: "weekdays")
    @py = CurriculumModule.create!(curriculum: @curriculum, name: "Python", position: 2, day_offset: 7, schedule_days: "weekdays")
    @decisions = Lesson.create!(curriculum_module: @js, title: "Make Decisions", position: 0, release_day: 63, requires_submission: true)
    @loops = Lesson.create!(curriculum_module: @js, title: "Loops", position: 1, release_day: 64, requires_submission: true)
    @lists = Lesson.create!(curriculum_module: @py, title: "Lists", position: 0, release_day: 70, requires_submission: true)
    @tickets = exercise(@decisions, "Ticket prices")
    @grades = exercise(@decisions, "Letter grades")
    @counter = exercise(@loops, "Counter")
    @list_block = exercise(@lists, "Shopping list")

    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current - 70, status: :active)
    @other = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current - 70, status: :active)
    @instructor = user(:instructor, "Ina", "Teach")
    @admin = user(:admin, "Ada", "Admin")
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @alex = user(:student, "Alex", "Rivera")
    @blair = user(:student, "Blair", "Cruz")
    @casey = user(:student, "Casey", "Diaz")
    @alex_e = Enrollment.create!(user: @alex, cohort: @cohort, status: :active)
    @blair_e = Enrollment.create!(user: @blair, cohort: @cohort, status: :active)
    @casey_e = Enrollment.create!(user: @casey, cohort: @other, status: :active)

    now = Time.current
    # Waiting, oldest first: blair tickets (5 d), alex counter (4 d), alex tickets attempt 2 (3 d), blair list (2 d).
    @old_attempt = submit(@alex_e, @tickets, now - 6.days, grade: "R", feedback: "Test 12")
    @w_blair_tickets = submit(@blair_e, @tickets, now - 5.days)
    @w_alex_counter = submit(@alex_e, @counter, now - 4.days)
    @w_alex_tickets = submit(@alex_e, @tickets, now - 3.days, num: 2)
    @w_blair_list = submit(@blair_e, @list_block, now - 2.days)
    @redo = submit(@blair_e, @grades, now - 7.days, grade: "R", feedback: "Add a C")
    @graded = submit(@alex_e, @grades, now - 8.days, grade: "A")
    @other_cohort = submit(@casey_e, @tickets, now - 9.days)
  end

  test "returns one page, oldest first, with a total and the items around it, and no answer text" do
    queue(@instructor, per_page: 2)
    assert_response :success
    body = response.parsed_body
    assert_equal [ @w_blair_tickets.id, @w_alex_counter.id ], ids
    assert_equal({ "page" => 1, "per_page" => 2, "total_count" => 4, "total_pages" => 2, "has_next_page" => true, "has_prev_page" => false }, body["meta"])
    assert_nil body["previous_id"]
    assert_equal @w_alex_tickets.id, body["next_id"]
    item = body["submissions"].first
    assert_not item.key?("text")
    assert_not item.key?("feedback")
    assert_equal [ "Blair Cruz", "Make Decisions", "Ticket prices", "Cohort 3", "program", 10, @w_blair_tickets.id ],
      item.values_at("user_name", "lesson_title", "content_block_title", "cohort_name", "course_delivery", "week_number", "latest_submission_id")

    queue(@instructor, per_page: 2, page: 2)
    assert_equal [ @w_alex_tickets.id, @w_blair_list.id ], ids
    assert_equal @w_alex_counter.id, response.parsed_body["previous_id"]
    assert_nil response.parsed_body["next_id"]

    # Past the end (the last item was just graded): the last page.
    queue(@instructor, per_page: 2, page: 9)
    assert_equal 2, response.parsed_body.dig("meta", "page")
  end

  test "newest first, and focus_id serves the page that holds the item" do
    queue(@instructor, per_page: 2, sort: "newest")
    assert_equal [ @w_blair_list.id, @w_alex_tickets.id ], ids
    queue(@instructor, per_page: 2, focus_id: @w_blair_list.id)
    assert_equal 2, response.parsed_body.dig("meta", "page")
    assert_includes ids, @w_blair_list.id
    # An item outside the list (graded) falls back to the page asked for.
    queue(@instructor, per_page: 2, page: 1, focus_id: @graded.id)
    assert_equal 1, response.parsed_body.dig("meta", "page")
  end

  test "counts the status chips and the options on the server, inside the other filters" do
    queue(@instructor)
    body = response.parsed_body
    assert_equal({ "ungraded" => 4, "redo" => 1, "all" => 7 }, body["counts"])
    assert_equal [ [ @js.id, "JavaScript", 3 ], [ @py.id, "Python", 1 ] ], body["modules"].map { |m| m.values_at("id", "name", "count") }
    assert_equal [ [ @alex.id, "Alex Rivera", 2 ], [ @blair.id, "Blair Cruz", 2 ] ], body["students"].map { |s| s.values_at("id", "name", "count") }
    assert_equal [ [ @cohort.id, "Cohort 3", @js.id, "JavaScript", 3 ], [ @cohort.id, "Cohort 3", @py.id, "Python", 1 ] ],
      body["module_grids"].map { |g| g.values_at("cohort_id", "cohort_name", "module_id", "module_name", "waiting") }
    assert_nil body["lesson"]

    # The superseded first attempt is in All but never waiting or redo.
    queue(@instructor, filter: "all")
    assert_includes ids, @old_attempt.id
    queue(@instructor, filter: "redo")
    assert_equal [ @redo.id ], ids

    # A module narrows the students and the counts; the module list ignores its own filter.
    queue(@instructor, module_id: @js.id)
    body = response.parsed_body
    assert_equal({ "ungraded" => 3, "redo" => 1, "all" => 6 }, body["counts"])
    assert_equal [ 3, 1 ], body["modules"].map { |m| m["count"] }
    assert_equal [ [ @alex.id, 2 ], [ @blair.id, 1 ] ], body["students"].map { |s| s.values_at("id", "count") }

    # Student and lesson together.
    queue(@instructor, student_id: @alex.id, lesson_id: @decisions.id, filter: "all")
    assert_equal [ @graded.id, @old_attempt.id, @w_alex_tickets.id ], ids
    assert_equal({ "id" => @decisions.id, "title" => "Make Decisions" }, response.parsed_body["lesson"])

    # A chosen module with nothing left in the status stays in the list with 0.
    queue(@instructor, module_id: @py.id, filter: "redo")
    assert_equal [ [ @js.id, 1 ], [ @py.id, 0 ] ], response.parsed_body["modules"].map { |m| m.values_at("id", "count") }
    assert_equal 0, response.parsed_body.dig("meta", "total_count")
  end

  test "an instructor sees their cohorts; an admin sees every cohort; others are refused" do
    queue(@admin, filter: "all")
    assert_includes ids, @other_cohort.id
    assert_equal 8, response.parsed_body.dig("counts", "all")
    queue(@instructor, filter: "all")
    assert_not_includes ids, @other_cohort.id
    queue(@instructor, cohort_id: @other.id)
    assert_response :forbidden
    queue(@alex)
    assert_response :forbidden
    queue(@admin, cohort_id: @other.id)
    assert_equal [ @other_cohort.id ], ids
  end

  test "caps the page size" do
    queue(@admin, filter: "all", per_page: 5000)
    assert_equal GradingQueue::MAX_PER_PAGE, response.parsed_body.dig("meta", "per_page")
  end

  test "a cohort with its own copy lists its work under the copy's ids, and old ids still filter" do
    f = build_shared_curriculum
    as_user(f.admin) { post "/api/v1/cohorts/#{f.cohort.id}/curriculum_copy", params: { source_curriculum_id: f.curriculum.id }, headers: auth_headers, as: :json }
    assert_response :created
    copy = response.parsed_body["curriculum_copy"]
    new_project = copy.dig("lesson_ids", f.lessons[:project].id.to_s)
    copy_module = f.cohort.reload.curriculum.modules.find_by!(name: "Week one")
    submissions = f.rows[:submissions].select { |row| row.enrollment.cohort_id == f.cohort.id }

    queue(f.admin, cohort_id: f.cohort.id, filter: "all")
    assert_equal submissions.map(&:id).sort, ids.sort
    assert_equal [ new_project ], response.parsed_body["submissions"].map { |item| item["lesson_id"] }.uniq
    assert_equal [ copy_module.id ], response.parsed_body["submissions"].map { |item| item["module_id"] }.uniq
    assert_equal [ [ f.cohort.id, copy_module.id ] ], response.parsed_body["module_grids"].map { |g| g.values_at("cohort_id", "module_id") }

    # A link from before the copy (old module and lesson ids) keeps its filter in this cohort.
    queue(f.admin, cohort_id: f.cohort.id, filter: "all", module_id: f.modules.first.id, lesson_id: f.lessons[:project].id)
    assert_equal submissions.map(&:id).sort, ids.sort
    assert_equal new_project, response.parsed_body.dig("lesson", "id")

    # The other cohort keeps the shared ids.
    queue(f.admin, cohort_id: f.other_cohort.id, filter: "all", lesson_id: f.lessons[:project].id)
    assert_equal [ f.lessons[:project].id ], response.parsed_body["submissions"].map { |item| item["lesson_id"] }.uniq

    # The module grid opens on the copy's module, and from the shared module's old id.
    [ copy_module.id, f.modules.first.id ].each do |module_id|
      as_user(f.admin) { get "/api/v1/cohorts/#{f.cohort.id}/modules/#{module_id}/submissions", headers: auth_headers }
      assert_response :success
      body = response.parsed_body
      assert_equal copy_module.id, body["module_id"]
      assert_equal submissions.map(&:id).sort, body["submissions"].map { |sub| sub["id"] }.sort
      assert_equal [ new_project ], body["submissions"].map { |sub| sub["lesson_id"] }.uniq
      assert_equal body["exercises"].map { |exercise| exercise["id"] }.sort & body["submissions"].map { |sub| sub["content_block_id"] }.uniq,
        body["submissions"].map { |sub| sub["content_block_id"] }.uniq
    end
  end

  private

  def exercise(lesson, title)
    lesson.content_blocks.create!(block_type: :exercise, position: lesson.content_blocks.count, title: title, submission_type: :text_submission)
  end

  def user(role, first, last)
    User.create!(clerk_id: "clerk_queue_#{first.downcase}", email: "#{first.downcase}.queue@example.com", first_name: first, last_name: last, role: role)
  end

  def submit(enrollment, block, at, grade: nil, feedback: nil, num: 1)
    Submission.create!(user: enrollment.user, enrollment: enrollment, content_block: block, submission_type: :text_submission,
      text: "Answer", grade: grade, feedback: feedback, graded_at: (grade ? at + 1.hour : nil), num_submissions: num, created_at: at, updated_at: at)
  end

  def queue(person, **params)
    as_user(person) { get "/api/v1/grading_queue", params: params, headers: auth_headers }
  end

  def ids = response.parsed_body["submissions"].map { |item| item["id"] }

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(person)
    payload = { "sub" => person.clerk_id, "email" => person.email, "first_name" => person.first_name, "last_name" => person.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
