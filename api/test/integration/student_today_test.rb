require "test_helper"
require_relative "../support/query_counter"

# W8 PR 8.2: the redesigned Today (`dashboard.today`) and My work. Statuses,
# counts and the next step come from LearnerProgress; a cohort with the new
# student experience off gets today's payload unchanged.
class StudentTodayTest < ActionDispatch::IntegrationTest
  include QueryCounter

  ZONE = Time.find_zone!("Pacific/Guam")
  # Wednesday of week 7 for a cohort that started Monday, Oct 5.
  NOW = ZONE.local(2026, 11, 18, 10)

  setup do
    travel_to NOW
    @curriculum = Curriculum.create!(name: "Today curriculum")
    @course = @curriculum.modules.create!(name: "JavaScript Foundations", position: 0, day_offset: 0, schedule_days: "weekdays")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Today cohort", start_date: Date.new(2026, 10, 5), end_date: Date.new(2027, 1, 22), status: :active,
      settings: { "features" => { "student_experience_v2" => true } })
    @teacher = person("audreana", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("blair", :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @course)
    # Seven weeks, three required lessons each, plus an optional one in week 5.
    @weeks = (1..7).to_h do |week|
      [ week, (0..2).map { |day| lesson("Week #{week} lesson #{day + 1}", (week - 1) * 7 + day) } ]
    end
    @optional = lesson("Week 5 stretch", 28 + 3, required: false)
    # Weeks 1-3 done: weeks 4-6 (nine lessons, three weeks of work) are overdue.
    @weeks.values_at(1, 2, 3).flatten.each { |item| complete(item) }
  end

  teardown { travel_back }

  test "a cohort with the switch off gets the old dashboard payload, with no student_today" do
    @cohort.update!(settings: { "features" => { "student_experience_v2" => false } })
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    off = response.parsed_body["dashboard"]
    assert_not off.key?("student_today")

    @cohort.update!(settings: {})
    SchoolSetting.current.update!(features: SchoolSetting.current.features.merge("student_experience_v2" => false))
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_not response.parsed_body["dashboard"].key?("student_today"), "only an explicit on adds it"

    @cohort.update!(settings: { "features" => { "student_experience_v2" => true } })
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    on = response.parsed_body["dashboard"]
    assert_equal off.keys + [ "student_today" ], on.keys, "the switch adds today and changes nothing else"
  end

  test "a learner behind schedule sees how far behind, the next lesson and this week, but no unagreed plan" do
    today = fetch_today
    assert_equal "program", today["mode"]
    assert_equal({ "current" => 7, "total" => 16 }, today["course_week"])
    assert_equal({ "behind" => true, "weeks_behind" => 3, "overdue_count" => 9 }, today["pace"])
    assert_equal @weeks[4].first.id, today.dig("next_lesson", "id")
    assert_equal({ "id" => @weeks[4].first.id, "week" => 4, "position" => 10, "module_lesson_count" => 22 }, today["next_lesson"].slice("id", "week", "position", "module_lesson_count"))
    assert_equal({ "completed_lessons" => 9, "total_lessons" => 22 }, today["counts"])
    assert_equal({ "total" => 3, "completed" => 0, "ends_on" => "2026-11-22" }, today["this_week"])
    assert_nil today["catch_up_plan"], "no plan until staff agree one"
    assert_equal({ "id" => @teacher.id, "full_name" => "Audreana Synthetic" }, today["reviewer"])

    # One week's straggler is about a week, not "6 weeks behind".
    @weeks.values_at(4, 5, 6).flatten.each { |item| complete(item) }
    complete_none = fetch_today
    assert_equal({ "behind" => false, "weeks_behind" => 0, "overdue_count" => 0 }, complete_none["pace"])
    Progress.where(content_block: @weeks[1].first.completion_blocks).delete_all
    assert_equal({ "behind" => false, "weeks_behind" => 0, "overdue_count" => 1 }, fetch_today["pace"])
  end

  test "an agreed catch-up plan names who saved it and lists its remaining lessons" do
    lessons = @weeks.values_at(4, 5, 6).flatten
    plan = LearningPlan.create!(enrollment: @enrollment, title: "Catch up by December", target_date: Date.new(2026, 12, 4),
      milestones: [ { "title" => "Week 4 and 5", "due_on" => "2026-11-25", "lesson_ids" => lessons.first(6).map(&:id) },
        { "title" => "Week 6", "due_on" => "2026-12-02", "lesson_ids" => lessons.last(3).map(&:id) } ])
    plan.revisions.create!(author: @teacher, snapshot: plan.snapshot)
    plan_json = fetch_today["catch_up_plan"]
    assert_equal "2026-12-04", plan_json["target_date"]
    assert_equal({ "id" => @teacher.id, "full_name" => "Audreana Synthetic" }, plan_json["agreed_by"])
    # The plan's own lessons not handed in yet, in milestone order.
    assert_equal 9, plan_json["remaining_count"]
    assert_equal lessons.map(&:id), plan_json["items"].map { |item| item["lesson_id"] }
    assert_equal "2026-11-25", plan_json["items"].first["due_on"]

    @cohort.update!(settings: { "features" => { "student_experience_v2" => true, "learning_plans" => false } })
    assert_nil fetch_today["catch_up_plan"], "learning plans off means no plan"
  end

  test "needs you quotes redo feedback, unread help answers and instructor messages; counts match My work" do
    redone = submit(@weeks[4].first, grade: "R", feedback: "Return the string instead, then **resubmit**.")
    submit(@weeks[5].first)
    submit(@weeks[5].second)
    graded = submit(@weeks[3].first, grade: "A", feedback: "Clean and readable.")

    help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: @weeks[4].second.id,
      context_label: "Week 4 lesson 2", context_path: "/lessons/#{@weeks[4].second.id}", category: :concept, message: "My loop never stops")
    reply = help.reply!(@teacher, body: "Check the condition **before** the loop.")
    NotificationDeliveryService.help_request_changed(help.reload, push: false, reply: reply)
    waiting_question = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: @weeks[4].third.id,
      context_label: "Week 4 lesson 3", context_path: "/lessons/#{@weeks[4].third.id}", category: :concept, message: "What is a closure?")

    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, @student ])
    Message.create!(direct_conversation: conversation, author: @teacher, body: "Nice work on the conditionals exercise.")

    today = fetch_today
    kinds = today.dig("needs_you", "items").map { |item| item["kind"] }
    assert_equal %w[redo help_answer message], kinds
    assert_equal 3, today.dig("needs_you", "count")
    redo_item = today.dig("needs_you", "items", 0)
    assert_equal [ redone.id, "Return the string instead, then **resubmit**.", "Audreana Synthetic", true ],
      [ redo_item["submission_id"], redo_item["feedback"], redo_item.dig("grader", "full_name"), redo_item["can_resubmit"] ]
    answer = today.dig("needs_you", "items", 1)
    assert_equal "/lessons/#{@weeks[4].second.id}?cohort_id=#{@cohort.id}&help_request=#{help.id}", answer["path"]
    assert_equal "Check the condition before the loop.", answer["excerpt"]
    assert_equal "Audreana Synthetic", answer.dig("replied_by", "full_name")
    message = today.dig("needs_you", "items", 2)
    assert_equal [ conversation.id, "Audreana Synthetic" ], [ message["direct_conversation_id"], message.dig("author", "full_name") ]
    assert_equal({ "count" => 1 }, today["questions"].slice("count"))
    assert_equal waiting_question.id, today.dig("questions", "items", 0, "id")
    assert_equal "/lessons/#{@weeks[4].third.id}?cohort_id=#{@cohort.id}&help_request=#{waiting_question.id}", today.dig("questions", "items", 0, "path")
    assert_equal 2, today.dig("waiting", "count")
    assert_equal [ graded.id ], today["recently_graded"].map { |item| item["submission_id"] }
    assert_equal "Audreana Synthetic", today.dig("recently_graded", 0, "grader", "full_name")

    get "/api/v1/my_work", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    work = response.parsed_body["my_work"]
    assert_equal({ "needs_you" => 1, "waiting" => 2, "graded" => 1 }, work["counts"])
    %w[needs_you waiting graded].each { |tab| assert_equal work.dig("counts", tab), work[tab].size, "#{tab} count is its list" }
    assert_equal today.dig("waiting", "count"), work["counts"]["waiting"]
    assert_nil work.dig("waiting", 0, "feedback")
    assert_equal({ "id" => @teacher.id, "full_name" => "Audreana Synthetic" }, work["reviewer"])

    # Read the answer and the message: they leave Needs you. A blocked instructor's messages never show.
    Notification.where(user: @student, notifiable: help).update_all(read_at: Time.current)
    conversation.direct_conversation_members.find_by!(user: @student).mark_read!
    assert_equal %w[redo], fetch_today.dig("needs_you", "items").map { |item| item["kind"] }
    travel 1.minute
    Message.create!(direct_conversation: conversation, author: @teacher, body: "Another note")
    assert_equal %w[redo message], fetch_today.dig("needs_you", "items").map { |item| item["kind"] }
    UserBlock.create!(blocker: @student, blocked_user: @teacher)
    assert_equal %w[redo], fetch_today.dig("needs_you", "items").map { |item| item["kind"] }
  end

  test "switched-off features disappear from Today" do
    @cohort.office_hours.create!(title: "Week 8: Loops in practice", starts_at: NOW + 10.days, ends_at: NOW + 10.days + 1.hour,
      meeting_url: "https://meet.example.com/class", timezone: "Pacific/Guam", recurrence: :once, created_by: @teacher)
    HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: @weeks[4].first.id,
      context_label: "Week 4 lesson 1", context_path: "/lessons/#{@weeks[4].first.id}", category: :concept, message: "Stuck")
    today = fetch_today
    # Next week's session, with its Join link (L-1.4).
    assert_equal [ "Week 8: Loops in practice", "https://meet.example.com/class" ], today["next_session"].values_at("title", "meeting_url")
    assert_equal 1, today.dig("questions", "count")

    @cohort.update!(settings: { "features" => { "student_experience_v2" => true, "office_hours" => false, "help_requests" => false } })
    today = fetch_today
    assert_nil today["next_session"]
    assert_equal({ "count" => 0, "items" => [] }, today["questions"])
    assert_equal "none", today.dig("support", "mode")
  end

  test "a paused learner has no next step to hand in, pace or session, and keeps their feedback" do
    submit(@weeks[3].first, grade: "B", feedback: "Works.")
    @cohort.office_hours.create!(title: "Office hours", starts_at: NOW + 1.day, ends_at: NOW + 1.day + 1.hour,
      meeting_url: "https://meet.example.com/office", timezone: "Pacific/Guam", recurrence: :once, created_by: @teacher)
    @enrollment.update!(status: :paused, paused_at: NOW - 2.weeks)
    today = fetch_today
    assert_equal [ true, true, nil, nil, nil ], today.values_at("read_only", "paused", "pace", "this_week", "next_session")
    assert_equal 1, today["reviews_count"]
    assert_equal "B", today.dig("recently_graded", 0, "grade")
  end

  test "self-paced and library learners have no pace; the library has no counts or next step" do
    @cohort.update!(course_delivery: "self_paced", end_date: nil)
    today = fetch_today
    assert_equal [ "self_paced", nil, nil ], today.values_at("mode", "pace", "course_week")
    assert_equal 10, today.dig("next_lesson", "number")

    alumni = Cohort.create!(curriculum: @curriculum, name: "Alumni", cohort_type: :alumni, start_date: Date.new(2026, 1, 5), status: :active,
      settings: { "features" => { "student_experience_v2" => true } })
    Enrollment.create!(user: @student, cohort: alumni, status: :active).module_assignments.find_or_create_by!(curriculum_module: @course)
    get "/api/v1/dashboard", params: { cohort_id: alumni.id }, headers: headers(@student)
    library = response.parsed_body.dig("dashboard", "student_today")
    assert_equal [ "library", nil, nil, nil ], library.values_at("mode", "counts", "next_lesson", "pace")
    assert_equal 5, library["recently_added"].size
  end

  test "a help answer's notification opens the lesson with its dialog; staff links stay plain" do
    help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :exercise, context_id: @weeks[4].first.content_blocks.last.id,
      context_label: "Practice", context_path: "/lessons/#{@weeks[4].first.id}", category: :concept, message: "Stuck")
    reply = help.reply!(@teacher, body: "Try this.")
    NotificationDeliveryService.help_request_changed(help.reload, push: false, reply: reply)
    notification = Notification.find_by!(user: @student, notifiable: help)
    block_id = @weeks[4].first.content_blocks.last.id
    assert_equal "/lessons/#{@weeks[4].first.id}?cohort_id=#{@cohort.id}&help_request=#{help.id}#block-#{block_id}", notification.destination_path
    assert_equal "/lesson/#{@weeks[4].first.id}?cohort_id=#{@cohort.id}&help_request=#{help.id}&block_id=#{block_id}",
      RecordDestination.to_native_href(notification.destination)
    assert_equal "/lessons/#{@weeks[4].first.id}?cohort_id=#{@cohort.id}#block-#{block_id}", LearningDestination.help_request(help), "other links keep the plain lesson"
  end

  test "My work is the learner's own, in a cohort they can read" do
    get "/api/v1/my_work", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :forbidden
    other = Cohort.create!(curriculum: @curriculum, name: "Other", start_date: Date.new(2026, 10, 5), status: :active)
    get "/api/v1/my_work", params: { cohort_id: other.id }, headers: headers(@student)
    assert_response :forbidden
    get "/api/v1/my_work", headers: headers(person("nobody", :student))
    assert_response :not_found
  end

  # Fix round: message actions go only to staff the learner can reach (review P2 2, 3).
  test "Ask about this feedback and Message go only to staff the learner can message now" do
    former = person("former", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: former)
    by_former = submit(@weeks[3].first, grade: "B", feedback: "Fine.", grader: former)
    by_teacher = submit(@weeks[3].second, grade: "A", feedback: "Great.")
    @cohort.cohort_instructor_assignments.find_by!(user: former).destroy!

    work = fetch_work
    row = ->(id) { work["graded"].find { |item| item["submission_id"] == id } }
    assert_equal "Former Synthetic", row.call(by_former.id).dig("grader", "full_name"), "the grader is still named"
    assert_equal @teacher.id, row.call(by_former.id).dig("ask_to", "id"), "a former instructor's row asks a current one"
    assert_equal @teacher.id, row.call(by_teacher.id).dig("ask_to", "id")
    assert_equal @teacher.id, work.dig("contact", "id")
    assert_equal true, fetch_today["can_ask_for_plan"]

    UserBlock.create!(blocker: @student, blocked_user: @teacher)
    work = fetch_work
    assert_nil row.call(by_teacher.id)["ask_to"], "nobody reachable: no action"
    assert_nil work["contact"]
    today = fetch_today
    assert_equal [ nil, false ], today.values_at("contact", "can_ask_for_plan")
    assert_equal "Audreana Synthetic", today.dig("reviewer", "full_name"), "the reviewer is still named"

    # Someone else who teaches the cohort becomes the contact.
    other = person("other", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: other)
    assert_equal other.id, fetch_work.dig("graded", 0, "ask_to", "id")
    get "/api/v1/my_work", params: { cohort_id: @cohort.id }, headers: headers(@student)
    post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ other.id ] }, headers: headers(@student), as: :json
    assert_response :created, "the offered contact really can be messaged"
  end

  test "asking for a catch-up plan needs learning plans on and someone to ask (review P2 7)" do
    assert_equal true, fetch_today["can_ask_for_plan"]
    @cohort.update!(settings: { "features" => { "student_experience_v2" => true, "learning_plans" => false } })
    assert_equal false, fetch_today["can_ask_for_plan"]
  end

  test "every waiting question is sent, so the count is reachable (review P2 6)" do
    6.times do |index|
      lesson = @weeks[4 + index / 3][index % 3]
      HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: lesson.id, context_label: lesson.title,
        context_path: "/lessons/#{lesson.id}", category: :concept, message: "Question #{index}")
    end
    questions = fetch_today["questions"]
    assert_equal 6, questions["count"]
    assert_equal 6, questions["items"].size
  end

  test "a busy conversation doesn't hide other unread conversations" do
    other = person("other", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: other)
    quiet = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ other, @student ])
    Message.create!(direct_conversation: quiet, author: other, body: "One note")
    travel 1.minute
    busy = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, @student ])
    15.times { |index| Message.create!(direct_conversation: busy, author: @teacher, body: "Busy #{index}") }
    messages = fetch_today.dig("needs_you", "items").select { |item| item["kind"] == "message" }
    assert_equal [ busy.id, quiet.id ], messages.map { |item| item["direct_conversation_id"] }
    assert_equal "Busy 14", messages.first["excerpt"]
  end

  test "lessons with no steps are left out of the pace and this week" do
    # Two empty lessons a week in weeks 1-4 would make the typical week 5 lessons, not 3.
    (0..3).each { |week| 2.times { |index| @course.lessons.create!(title: "Week #{week + 1} notice #{index}", position: 90 + index, release_day: week * 7 + 3, lesson_type: :exercise, required: true) } }
    @course.lessons.create!(title: "Week 7 notice", position: 99, release_day: 44, lesson_type: :exercise, required: true)
    today = fetch_today
    assert_equal({ "behind" => true, "weeks_behind" => 3, "overdue_count" => 9 }, today["pace"])
    assert_equal 3, today.dig("this_week", "total")
  end

  test "a redo on a lesson that is locked again stays in Needs you without a resubmit action" do
    locked = lesson("Week 9 lesson", 8 * 7)
    submit(locked, grade: "R", feedback: "Try again later.")
    item = fetch_work["needs_you"].find { |row| row["lesson_id"] == locked.id }
    assert_equal false, item["can_resubmit"]
    open_redo = submit(@weeks[4].first, grade: "R", feedback: "Again.")
    assert_equal true, fetch_work["needs_you"].find { |row| row["submission_id"] == open_redo.id }["can_resubmit"]
  end

  test "Today and My work cost the same queries however much work there is" do
    today = -> { count_queries { fetch_today } }
    work = -> { count_queries { get("/api/v1/my_work", params: { cohort_id: @cohort.id }, headers: headers(@student)).tap { assert_response :success } } }
    seed_activity(1)
    today.call
    work.call
    small = [ today.call, work.call ]

    seed_activity(4)
    grown = [ today.call, work.call ]
    grown_work = response.parsed_body["my_work"]
    assert_operator grown_work["needs_you"].size + grown_work["waiting"].size + grown_work["graded"].size, :>=, 12, "the fixture really grew"
    assert_operator fetch_today.dig("needs_you", "count"), :>=, 6
    assert_equal small, grown, "Today and My work cost the same for 3 submissions or 15"
  end

  private

  def fetch_work
    get "/api/v1/my_work", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    response.parsed_body["my_work"]
  end

  def fetch_today
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    response.parsed_body.dig("dashboard", "student_today")
  end

  # Graded, redo and waiting work, help answers and staff messages, `count` of each.
  def seed_activity(count)
    @seeded ||= 0
    graders = [ @teacher, *Array.new(count) { |index| person("grader#{@seeded}#{index}", :instructor).tap { |user| @cohort.cohort_instructor_assignments.create!(user: user) } } ]
    count.times do |index|
      week_lessons = @weeks.values.flatten
      base = (@seeded + index) * 3
      submit(week_lessons[base % 21], grade: "A", feedback: "Good", grader: graders[index % graders.size])
      submit(week_lessons[(base + 1) % 21], grade: "R", feedback: "Again", grader: graders[(index + 1) % graders.size])
      submit(week_lessons[(base + 2) % 21])
      help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :exercise, context_id: week_lessons[base % 21].content_blocks.last.id,
        context_label: "Ask #{base}", context_path: "/lessons/1", category: :concept, message: "Help #{base}")
      reply = help.reply!(graders[index % graders.size], body: "Answer #{base}")
      NotificationDeliveryService.help_request_changed(help.reload, push: false, reply: reply)
      conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ graders[index % graders.size], @student ])
      Message.create!(direct_conversation: conversation, author: graders[index % graders.size], body: "Note #{base}")
    end
    @seeded += count
  end

  def lesson(title, release_day, required: true)
    lesson = @course.lessons.create!(title: title, position: release_day, release_day: release_day, lesson_type: :exercise, required: required)
    lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Text")
    lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Practice", submission_type: :text_submission)
    lesson
  end

  def submit(lesson, grade: nil, feedback: nil, grader: @teacher)
    Submission.create!(user: @student, enrollment: @enrollment, content_block: lesson.content_blocks.last, text: "Answer",
      grade: grade, feedback: feedback, graded_at: grade && Time.current, graded_by_id: grade && grader.id)
  end

  def complete(lesson)
    lesson.completion_blocks.each do |block|
      Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed, completed_at: NOW - 1.day)
    end
  end

  def person(name, role)
    User.create!(clerk_id: "today_#{name}", email: "today-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
