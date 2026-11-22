require "test_helper"
require_relative "../support/query_counter"
require Rails.root.join("db/migrate/20261117090000_add_course_marketing_and_orientation").to_s

class CatalogCoursePagesTest < ActionDispatch::IntegrationTest
  include QueryCounter
  setup do
    @admin = User.create!(clerk_id: "catalog_admin", email: "catalog-admin@example.test", role: :admin)
    @student = User.create!(clerk_id: "catalog_student", email: "catalog-student@example.test", role: :student)
    @teacher = User.create!(clerk_id: "catalog_teacher", email: "catalog-teacher@example.test", role: :instructor)
    @curriculum = Curriculum.create!(name: "Internal curriculum", status: :active)
    @mod = @curriculum.modules.create!(name: "Staff notes", position: 0)
    @lesson = @mod.lessons.create!(title: "Build a counter", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, submission_type: :text_submission, body: "Private instructions", solution: "Private answer", position: 0)
    @cohort = Cohort.create!(name: "Internal pilot", curriculum: @curriculum, start_date: LearningCalendar.today, course_delivery: "self_paced", public_checkout_enabled: true,
      public_title: "Useful programming", public_description: "Learn a skill", public_outcomes: "Build a small project", public_duration: "4 hours", public_prerequisites: "No experience needed", public_preview: "Try a counter", public_price_cents: 14900, stripe_price_id: "price_catalog")
    @cohort.instructors << @teacher
    @cohort.update!(support_instructor: @teacher)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    @enrollment.assign_cohort_content_defaults!
  end

  test "index and slug detail expose the exact public allowlist and selected active lesson titles only" do
    @mod.lessons.create!(title: "Archived secret", position: 1, release_day: 0, archived_at: Time.current).content_blocks.create!(block_type: :text, body: "Hidden", position: 0)
    @mod.lessons.create!(title: "Unpublished empty lesson", position: 2, release_day: 0)
    excluded = @curriculum.modules.create!(name: "Unselected secret", position: 1)
    excluded.lessons.create!(title: "Unselected lesson", position: 0, release_day: 0).content_blocks.create!(block_type: :text, body: "Hidden", position: 0)
    get "/api/v1/course_offerings"
    assert_response :success
    assert_equal %w[offerings public_catalog_mode], response.parsed_body.keys.sort
    list = response.parsed_body.fetch("offerings").sole
    get "/api/v1/course_offerings/#{@cohort.public_slug}"
    assert_response :success
    assert_equal [ "offering" ], response.parsed_body.keys
    detail = response.parsed_body.fetch("offering")
    assert_equal list, detail
    assert_equal %w[access_months checkout_available course_delivery curriculum_name currency description duration guided_access_ends_on guided_support_ends_on id image_url includes_individual_project_review includes_private_meetings instructor_message_weeks instructor_response_target lesson_count name outcomes prerequisites preview price_cents seat_limit seats_remaining seats_taken slug sold_out syllabus unlisted].sort, detail.keys.sort
    assert_equal [ { "title" => "Section", "lessons" => [ "Build a counter" ] } ], detail["syllabus"]
    assert_equal 1, detail["lesson_count"]
    assert_equal "Build a small project", detail["outcomes"]
    assert detail["includes_individual_project_review"]
    %w[Internal Staff Private Archived Unpublished Unselected].each { |secret| refute_includes response.body, secret }
  end

  test "unlisted archived upcoming non self paced and draft curriculum offerings are unavailable by slug" do
    [ { public_checkout_enabled: false }, { status: :archived }, { start_date: LearningCalendar.today + 5, status: :upcoming } ].each do |attributes|
      @cohort.update!(attributes)
      get "/api/v1/course_offerings/#{@cohort.public_slug}"
      assert_response :not_found
      get "/api/v1/course_offerings"
      assert_empty response.parsed_body["offerings"]
      @cohort.update!(public_checkout_enabled: true, start_date: LearningCalendar.today, status: :active)
    end
    @curriculum.update!(status: :draft)
    get "/api/v1/course_offerings/#{@cohort.public_slug}"
    assert_response :not_found
  end

  test "slugs are unique stable and never derived from internal names" do
    slug = @cohort.public_slug
    assert_equal "useful-programming", slug
    @cohort.update!(public_title: "Another public title", name: "Another private label")
    assert_equal slug, @cohort.reload.public_slug
    @cohort.public_slug = "replacement"
    assert_not @cohort.valid?
    other = @cohort.dup
    other.public_slug = slug
    assert_not other.valid?
    assert_includes other.errors[:public_slug], "has already been taken"
  end

  test "admins save marketing copy without changing checkout and learners cannot edit" do
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}", params: { public_outcomes: "Explain a program", public_duration: "6 hours", public_prerequisites: "A browser", public_preview: "Read the example" }, headers: headers, as: :json
    end
    assert_response :success
    assert @cohort.reload.public_checkout_enabled?
    assert_equal "Explain a program", @cohort.public_outcomes
    assert_equal "6 hours", @cohort.public_duration
    as_user(@student) { patch "/api/v1/cohorts/#{@cohort.id}", params: { public_preview: "Changed" }, headers: headers, as: :json }
    assert_response :forbidden
  end

  test "school response time cohort override and reset preserve all feature and checkout switches" do
    SchoolSetting.current.update!(features: { recordings: false })
    @cohort.update!(settings: { features: { office_hours: false } })
    as_user(@admin) do
      patch "/api/v1/feature_settings", params: { review_response_time: "usually reviewed within 3 days" }, headers: headers, as: :json
      assert_response :success
      assert_equal "usually reviewed within 3 days", @cohort.effective_review_response_time
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", params: { review_response_time: "usually reviewed within 1 day" }, headers: headers, as: :json
      assert_response :success
      assert_equal "usually reviewed within 1 day", @cohort.reload.effective_review_response_time
      get "/api/v1/course_offerings/#{@cohort.public_slug}"
      assert_equal "usually reviewed within 1 day", response.parsed_body.dig("offering", "instructor_response_target")
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", params: { review_response_time: nil }, headers: headers, as: :json
      assert_response :success
      assert_equal "usually reviewed within 3 days", @cohort.reload.effective_review_response_time
      patch "/api/v1/feature_settings", params: { review_response_time: nil }, headers: headers, as: :json
      assert_response :unprocessable_entity
    end
    assert_equal({ "recordings" => false }, SchoolSetting.current.reload.features)
    assert_equal({ "office_hours" => false }, @cohort.reload.settings["features"])
    assert @cohort.public_checkout_enabled?
    as_user(@student) { patch "/api/v1/feature_settings", params: { review_response_time: "instantly" }, headers: headers, as: :json }
    assert_response :forbidden
  end

  test "Today starts support and shows orientation until explicitly dismissed only for its learner" do
    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers
      assert_response :success
      assert_equal true, response.parsed_body.dig("dashboard", "start_here")
      assert_equal "usually reviewed within 2 days", response.parsed_body.dig("dashboard", "review_response_time")
      assert @enrollment.reload.support_expires_at
      patch "/api/v1/dashboard/start_here", params: { cohort_id: @cohort.id }, headers: headers, as: :json
      assert_response :success
      first = @enrollment.reload.start_here_dismissed_at
      assert first
      patch "/api/v1/dashboard/start_here", params: { cohort_id: @cohort.id }, headers: headers, as: :json
      assert_equal first, @enrollment.reload.start_here_dismissed_at
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers
      assert_equal false, response.parsed_body.dig("dashboard", "start_here")
    end
    as_user(@admin) { patch "/api/v1/dashboard/start_here", params: { cohort_id: @cohort.id }, headers: headers, as: :json }
    assert_response :not_found
  end

  test "self paced work reaches the same assigned instructor grading queue with delivery mode" do
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, text: "My explanation", submission_type: :text_submission)
    as_user(@teacher) { get "/api/v1/grading_queue", params: { cohort_id: @cohort.id }, headers: headers }
    assert_response :success
    row = response.parsed_body["submissions"].sole
    assert_equal "self_paced", row["course_delivery"]
    assert_equal @enrollment.id, row["enrollment_id"]
  end

  test "unknown slug lookup stays flat as the catalog grows" do
    before = count_queries { get "/api/v1/course_offerings/missing-public-course" }
    assert_response :not_found
    20.times do |i|
      Cohort.create!(name: "Private #{i}", public_title: "Public #{i}", curriculum: @curriculum,
        start_date: LearningCalendar.today, course_delivery: "self_paced", public_checkout_enabled: true)
    end
    after = count_queries { get "/api/v1/course_offerings/missing-public-course" }
    assert_response :not_found
    assert_equal before, after
    assert_operator after, :<=, 4
  end

  test "public titles generate readable transliterated collision-safe immutable addresses" do
    records = [ "Pýthon fündaméntals", "Python fundamentals", "Python fundamentals" ].map do |title|
      Cohort.create!(name: "Never expose this name", public_title: title, curriculum: @curriculum, start_date: LearningCalendar.today)
    end
    assert_equal %w[python-fundamentals python-fundamentals-2 python-fundamentals-3], records.map(&:public_slug)
    blank = Cohort.create!(name: "Internal draft", curriculum: @curriculum, start_date: LearningCalendar.today)
    reserved = Cohort.create!(name: "Internal", public_title: "Checkout", curriculum: @curriculum, start_date: LearningCalendar.today)
    assert_nil blank.public_slug
    assert_equal "course-#{reserved.id}", reserved.public_slug
    blank.update!(public_title: "New public name")
    assert_equal "new-public-name", blank.reload.public_slug
    records.first.update!(public_title: "Renamed")
    assert_equal "python-fundamentals", records.first.reload.public_slug
  end

  test "late public titles share the readable collision suffix sequence" do
    rows = 2.times.map do
      Cohort.create!(name: "Internal draft", curriculum: @curriculum, start_date: LearningCalendar.today)
    end
    rows.each { |row| assert_nil row.public_slug }
    rows.each { |row| row.update!(public_title: "Python fundamentals") }
    assert_equal %w[python-fundamentals python-fundamentals-2], rows.map { |row| row.reload.public_slug }
  end

  test "a stale instance keeps the first public slug assigned by another instance" do
    row = Cohort.create!(name: "Wizard draft", curriculum: @curriculum, start_date: LearningCalendar.today)
    first = Cohort.find(row.id)
    stale = Cohort.find(row.id)
    assert_nil stale.public_slug
    first.update!(public_title: "Python")
    stale.update!(public_title: "Ruby")
    assert_equal "python", first.public_slug
    assert_equal "python", stale.public_slug
    assert_equal "python", row.reload.public_slug
    assert_equal "Ruby", row.public_title
  end

  test "titles with underscores get a valid slug and the course stays savable" do
    row = Cohort.create!(name: "Internal", public_title: "Intro_to_Python", curriculum: @curriculum, start_date: LearningCalendar.today)
    assert_equal "intro-to-python", row.public_slug
    edge = Cohort.create!(name: "Internal", public_title: "__x__", curriculum: @curriculum, start_date: LearningCalendar.today)
    assert_equal "x", edge.public_slug
    assert row.reload.update(public_description: "Still savable"), row.errors.full_messages.to_sentence

    Cohort.where(id: [ row.id, edge.id ]).update_all(public_slug: nil)
    AddCourseMarketingAndOrientation.new.send(:backfill_public_slugs)
    assert_equal %w[intro-to-python x], [ row.reload.public_slug, edge.reload.public_slug ]
  ensure
    ActiveRecord::Base.connection_pool.connections.each(&:clear_cache!)
  end

  test "a reserved title assigned after creation receives a stable ID fallback" do
    row = Cohort.create!(name: "Internal draft", curriculum: @curriculum, start_date: LearningCalendar.today)
    assert_nil row.public_slug
    row.update!(public_title: "Checkout")
    assert_equal "course-#{row.id}", row.reload.public_slug
    row.update!(public_title: "Another title")
    assert_equal "course-#{row.id}", row.reload.public_slug
  end

  test "courses awaiting a first slug are not listed reachable or serializable" do
    untitled = Cohort.create!(name: "Internal draft", curriculum: @curriculum, start_date: LearningCalendar.today,
      course_delivery: "self_paced", public_checkout_enabled: true)
    # A rolling migration can also leave a titled row awaiting its first save.
    Cohort.where(id: [ untitled.id, @cohort.id ]).update_all(public_slug: nil)
    get "/api/v1/course_offerings"
    assert_response :success
    assert_empty response.parsed_body.fetch("offerings")
    get "/api/v1/course_offerings/course-#{untitled.id}"
    assert_response :not_found
  end

  test "public serializer rejects a course awaiting its first slug" do
    @cohort.public_slug = nil
    assert_raises(ActiveRecord::RecordNotFound) { PublicCourseSerializer.call(@cohort) }
  end

  test "migration backfill uses public titles with the same transliteration collision and reserved-route rules" do
    rows = [ "Café studio", "Cafe studio", "Cafe studio", nil, " \t\n", "Checkout" ].map do |title|
      Cohort.create!(name: "Internal label", public_title: title, curriculum: @curriculum, start_date: LearningCalendar.today)
    end
    expected = [ "cafe-studio", "cafe-studio-2", "cafe-studio-3", nil, nil, "course-#{rows.last.id}" ]
    Cohort.where(id: rows.map(&:id)).update_all(public_slug: nil)
    AddCourseMarketingAndOrientation.new.send(:backfill_public_slugs)
    assert_equal expected, rows.map { |row| row.reload.public_slug }
    rows[3].update!(public_title: "Python fundamentals")
    assert_equal "python-fundamentals", rows[3].reload.public_slug
  ensure
    ActiveRecord::Base.connection_pool.connections.each(&:clear_cache!)
  end

  private

  def headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
