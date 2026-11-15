require "test_helper"

class SearchTest < ActionDispatch::IntegrationTest
  setup do
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @student = person("student", :student)
    @other = person("outsider", :student)
    @curriculum = Curriculum.create!(name: "Synthetic curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Synthetic module", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Synthetic lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Synthetic work", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Synthetic cohort", start_date: 14.days.ago.to_date, status: :active,
      settings: { class_resources: [ { title: "Synthetic resource", url: "https://example.invalid/resource" } ] })
    @elsewhere = Cohort.create!(curriculum: Curriculum.create!(name: "Forbidden curriculum"), name: "Forbidden cohort", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active, joined_at: 1.day.ago)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @module, unlocked: true)
    @other_enrollment = Enrollment.create!(user: @other, cohort: @elsewhere, status: :active, joined_at: 1.day.ago)
    @submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "Synthetic answer")
    @help = HelpRequest.create!(student: @student, cohort: @cohort, category: :concept, context_type: :lesson, context_id: @lesson.id,
      context_label: "Synthetic question", context_path: "/lessons/#{@lesson.id}", message: "Synthetic help")
    @plan = Intervention.create!(enrollment: @enrollment, owner: @instructor, created_by: @instructor, trigger_type: :help_request, next_follow_up_at: 2.days.from_now, action_summary: "Synthetic follow-up")
    @channel = @cohort.workspace.channels.create!(name: "Synthetic channel", visibility: :cohort)
    @dm = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @instructor ])
    Message.create!(direct_conversation: @dm, author: @student, body: "Synthetic message")
    @update = Announcement.create!(author: @instructor, cohort: @cohort, audience: :cohort, title: "Synthetic update", body: "Synthetic update body", status: :published)
    @recording = Recording.create!(cohort: @cohort, title: "Synthetic recording", source_kind: "external", source_url: "https://example.invalid/recording", status: :published, published_at: 1.hour.ago)
    @file = CurriculumResource.create!(curriculum: @curriculum, title: "Synthetic file", filename: "synthetic.zip", s3_key: "synthetic/key", file_size: 10, upload_key: "synthetic-upload", upload_expires_at: 1.day.from_now, ready: true, ready_at: 1.hour.ago)
  end

  test "authorization matrix for every searchable type and populated contract" do
    expected = %w[student staff cohort curriculum module lesson submission help_request follow_up channel dm message announcement recording resource]
    { @admin => expected - %w[dm message], @instructor => expected - %w[staff], @student => expected - %w[student staff follow_up] }.each do |viewer, types|
      search(viewer, "Synthetic")
      assert_response :success
      assert_equal types.sort, groups.keys.sort, "role #{viewer.role}: #{response.body}"
      assert groups.values.all? { |group| group.size <= 5 }
      refute response.body.include?("total")
      groups.values.flatten.each { |record| assert RecordDestination.to_web_path(record["destination"]), record.inspect }
    end
  end

  test "another cohort student and all their work are invisible, even when names match" do
    @elsewhere.update!(name: "Synthetic forbidden cohort")
    @other.update!(first_name: "Synthetic forbidden")
    Submission.create!(user: @other, enrollment: @other_enrollment, content_block: @block, submission_type: :text_submission, text: "Synthetic forbidden answer")
    HelpRequest.create!(student: @other, cohort: @elsewhere, category: :concept, context_type: :lesson, context_id: @lesson.id,
      context_label: "Synthetic forbidden question", context_path: "/lessons/#{@lesson.id}", message: "Synthetic forbidden help")
    Intervention.create!(enrollment: @other_enrollment, owner: @admin, created_by: @admin, trigger_type: :inactivity, next_follow_up_at: 2.days.from_now, action_summary: "Synthetic forbidden plan")
    [ @student, @instructor ].each do |viewer|
      search(viewer, "Synthetic")
      assert_response :success
      refute_includes response.body, "forbidden"
    end
  end

  test "students cannot search a classmate's answers or help in their own cohort" do
    classmate = person("classmate", :student)
    enrollment = Enrollment.create!(user: classmate, cohort: @cohort, status: :active)
    Submission.create!(user: classmate, enrollment: enrollment, content_block: @block, submission_type: :text_submission, text: "Secretclassmate answer")
    HelpRequest.create!(student: classmate, cohort: @cohort, category: :concept, context_type: :lesson, context_id: @lesson.id,
      context_label: "Secretclassmate title", context_path: "/lessons/#{@lesson.id}", message: "Secretclassmate help")
    search(@student, "Secretclassmate")
    assert_empty groups
    refute_includes response.body, "Secretclassmate"
  end

  test "instructors cannot find any content from an unassigned curriculum" do
    mod = CurriculumModule.create!(curriculum: @elsewhere.curriculum, name: "Forbidden module", position: 0)
    Lesson.create!(curriculum_module: mod, title: "Forbidden lesson", position: 0)
    @elsewhere.channels.create!(name: "Forbidden channel", visibility: :cohort)
    Announcement.create!(author: @admin, cohort: @elsewhere, audience: :cohort, title: "Forbidden update", body: "Forbidden snippet", status: :published)
    Recording.create!(cohort: @elsewhere, title: "Forbidden recording", source_kind: "external", source_url: "https://example.invalid/recording", status: :published)
    search(@instructor, "Forbidden")
    assert_empty groups
    refute_includes response.body, "Forbidden"
  end

  test "hidden lesson never leaks title or snippet, including through own work" do
    @lesson.update!(release_day: 999, title: "Synthetic secret")
    @help.update!(context_label: "Synthetic secret", message: "Synthetic secret")
    @submission.update!(text: "Synthetic secret")
    search(@student, "Synthetic")
    refute_includes response.body, "secret"
    refute groups.key?("lesson")
    refute groups.key?("submission")
    refute groups.key?("help_request")
  end

  test "feature switches omit every disabled type without snippets" do
    @cohort.update!(settings: { features: { help_requests: false, interventions: false, recordings: false, announcements: false, class_channels: false } })
    [ @student, @instructor ].each do |viewer|
      search(viewer, "Synthetic")
      %w[help_request follow_up recording announcement].each { |type| refute groups.key?(type) }
    end
    search(@student, "Synthetic")
    refute groups.key?("channel")
  end

  test "DM membership is required even for administrators" do
    search(@admin, "Synthetic")
    refute groups.key?("dm")
    refute groups.key?("message")
    search(@other, "Synthetic")
    refute groups.key?("dm")
    refute groups.key?("message")
  end

  test "plain snippets contain no markup and exact name and handle rank first" do
    6.times { |n| Cohort.create!(curriculum: @curriculum, name: "Synthetic extra #{n}", start_date: Date.current) }
    @cohort.update!(name: "Synthetic")
    @update.update!(body: "<script>alert('x')</script> Synthetic <b>safe</b>")
    @student.update!(handle: "synthetic")
    search(@admin, "Synthetic")
    assert_equal @cohort.id.to_s, groups.fetch("cohort").first["id"]
    assert_equal @student.id.to_s, groups.fetch("student").first["id"]
    refute_includes groups.fetch("announcement").first["snippet"], "<"
    search(@admin, "@synthetic")
    assert_equal @student.id.to_s, groups.fetch("student").first["id"]
  end

  test "query count stays constant as matching records grow" do
    count_queries(@student) # warm model metadata
    before = count_queries(@student)
    8.times { |n| Lesson.create!(curriculum_module: @module, title: "Synthetic #{n}", position: n + 1, release_day: 0) }
    assert_equal before, count_queries(@student)
  end

  test "blank and punctuation queries safely return no records" do
    [ "", "a", "& | ! :", "'" ].each do |query|
      search(@student, query)
      assert_response :success
      assert_empty groups
    end
  end

  test "search shares the existing search bucket and returns friendly rate limit" do
    ApiRateLimits::STORE.write("rate-limit:authenticated-api:search:#{@student.id}", 900, expires_in: 1.minute)
    search(@student, "Synthetic")
    assert_response :too_many_requests
    assert_equal "60", response.headers["Retry-After"]
  end

  private

  def groups = response.parsed_body.fetch("groups").to_h { |group| [ group.fetch("type"), group.fetch("results") ] }

  def person(name, role)
    User.create!(clerk_id: "search-#{name}", email: "search-#{name}@example.invalid", first_name: "Synthetic", last_name: name, role: role)
  end

  def search(viewer, query)
    original = ClerkAuth.method(:verify)
    payload = { "sub" => viewer.clerk_id, "email" => viewer.email, "first_name" => viewer.first_name, "last_name" => viewer.last_name }
    ClerkAuth.define_singleton_method(:verify) { |_| payload }
    get "/api/v1/search", params: { q: query }, headers: { "Authorization" => "Bearer test" }
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def count_queries(viewer)
    count = 0
    callback = ->(*, payload) { count += 1 unless payload[:name] == "SCHEMA" || payload[:cached] }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { RecordSearch.new(viewer: viewer.reload, query: "Synthetic").call }
    count
  end
end
