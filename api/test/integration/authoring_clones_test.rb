require "test_helper"
require_relative "../support/curriculum_copy_fixture"
require_relative "../support/query_counter"

class AuthoringClonesTest < ActionDispatch::IntegrationTest
  include CurriculumCopyFixture
  include QueryCounter

  setup do
    @f = build_shared_curriculum
    @admin = @f.admin
  end

  test "curriculum clone is independent draft with definitions, archived lessons, media and remapped links but no learner data" do
    key = "content_videos/#{SecureRandom.uuid}/synthetic.mp4"
    @f.blocks.fetch(:video).update_columns(s3_video_key: key, s3_video_duration_seconds: 100)
    before = learner_counts
    clone_request("curricula", @f.curriculum.id)
    assert_response :created
    copy = Curriculum.find(response.parsed_body.dig("clone", "id"))
    assert copy.draft?
    assert_empty copy.cohorts
    assert_nil copy.course_package_key
    assert_equal 2, copy.modules.count
    lessons = Lesson.where(module_id: copy.modules.select(:id)).index_by(&:title)
    assert_equal 4, lessons.size
    assert lessons.fetch("Retired").archived?
    objective = copy.learning_objectives.sole
    rubric = copy.rubrics.sole
    assert_equal objective.id, rubric.rubric_criteria.sole.learning_objective_id
    read = lessons.fetch("Intro").content_blocks.find_by!(title: "Read")
    exercise = lessons.fetch("Project").content_blocks.sole
    assert_equal rubric.id, exercise.rubric_id
    assert_includes read.body, "/lessons/#{lessons.fetch('Project').id}#block-#{exercise.id}"
    assert_equal objective.id, lessons.fetch("Intro").content_blocks.find_by!(title: "Check").knowledge_check.learning_objective_id
    assert_equal key, lessons.fetch("Intro").content_blocks.find_by!(title: "Watch").s3_video_key
    assert_equal @f.resource.s3_key, copy.curriculum_resources.sole.s3_key
    assert_equal before, learner_counts
    assert_equal @f.curriculum.id, @f.cohort.reload.curriculum_id
    clone_request("curricula", @f.curriculum.id)
    assert_response :ok
    assert response.parsed_body["replayed"]
    assert_equal copy.id, response.parsed_body.dig("clone", "id")
    clone_request("curricula", @f.curriculum.id, name: "Different")
    assert_response :conflict
    as_user(@f.learner) do
      get "/api/v1/modules/#{copy.modules.first.id}", headers: headers
      assert_response :forbidden
      get "/api/v1/curricula/#{copy.id}", headers: headers
      assert_response :forbidden
    end
  end

  test "module clones at position into same or other curriculum without learner callbacks or definition collisions" do
    before = learner_counts
    destination = Curriculum.create!(name: "Destination")
    destination.learning_objectives.create!(@f.objective.attributes.except("id", "curriculum_id", "created_at", "updated_at"))
    clone_request("modules", @f.modules.first.id, curriculum_id: destination.id, position: 0)
    assert_response :created
    mod = CurriculumModule.find(response.parsed_body.dig("clone", "id"))
    assert_equal destination.id, mod.curriculum_id
    assert_equal 3, mod.all_lessons.count
    assert_empty mod.lessons
    block = mod.all_lessons.find_by!(title: "Project").content_blocks.sole
    assert_equal destination.id, block.rubric.curriculum_id
    assert_equal destination.id, block.rubric.rubric_criteria.sole.learning_objective.curriculum_id
    @f.modules.last.update_columns(position: 8)
    clone_request("modules", @f.modules.first.id, curriculum_id: @f.curriculum.id, position: 1, client_request_id: "same-module-0001")
    assert_response :created
    assert_equal [ @f.modules.first.id, response.parsed_body.dig("clone", "id"), @f.modules.last.id ], @f.curriculum.modules.reload.map(&:id)
    assert_equal [ 0, 1, 2 ], @f.curriculum.modules.pluck(:position)
    assert_equal before, learner_counts
    clone_request("modules", @f.modules.first.id, curriculum_id: @f.curriculum.id, position: 1, client_request_id: "same-module-0001")
    assert_response :ok
  end

  test "cohort clone shifts schedule and config preserving inherited switches without people or activity" do
    source = @f.cohort
    source.update!(settings: source.settings.merge("features" => { "recordings" => nil, "help_requests" => false, "office_hours" => true }))
    SchoolSetting.current.update!(features: { "recordings" => false })
    source.create_private_meeting_config!(instructor: @admin, weeks: 4)
    source.office_hours.create!(title: "Office", starts_at: Time.utc(2026, 11, 1, 9), ends_at: Time.utc(2026, 11, 1, 10), timezone: "America/New_York", recurrence: :weekly, meeting_url: "https://example.invalid/meet")
    start = LearningCalendar.today + 60
    days = (start - source.start_date).to_i
    before = learner_counts
    [ false, true ].each do |with_curriculum|
      options = { start_date: start.iso8601, clone_curriculum: with_curriculum, client_request_id: "cohort-clone-#{with_curriculum}" }
      clone_request("cohorts", source.id, **options)
      assert_response :created
      json = response.parsed_body.fetch("clone")
      assert_equal false, json.fetch("features").fetch("recordings")
      assert_nil json.fetch("feature_overrides").fetch("recordings")
      copy = Cohort.find(json.fetch("id"))
      assert copy.upcoming?
      refute copy.public_checkout_enabled
      assert_equal source.settings["features"], copy.settings["features"]
      assert_equal source.course_delivery, copy.course_delivery
      assert_equal source.private_meeting_config.weeks, copy.private_meeting_config.weeks
      assert_equal source.office_hours.sole.starts_at.in_time_zone("America/New_York").advance(days: days), copy.office_hours.sole.starts_at
      assert_equal source.cohort_module_schedules.order(:start_date).pluck(:start_date).map { |date| date + days }, copy.cohort_module_schedules.order(:start_date).pluck(:start_date)
      assert_equal source.cohort_module_submission_windows.count, copy.cohort_module_submission_windows.count
      [ :enrollments, :course_purchases, :announcements, :recordings, :direct_conversations ].each { |association| assert_empty copy.public_send(association) }
      assert_equal before, learner_counts
      if with_curriculum
        assert copy.curriculum.draft?
        refute_equal source.curriculum_id, copy.curriculum_id
        assert_empty copy.cohort_module_schedules.pluck(:module_id) - copy.curriculum.modules.pluck(:id)
      else
        assert_equal source.curriculum_id, copy.curriculum_id
      end
      clone_request("cohorts", source.id, **options)
      assert_response :ok
      assert_equal copy.id, response.parsed_body.dig("clone", "id")
    end
  end

  test "invalid options and unauthorized users leave no clone" do
    %w[curricula modules cohorts].each do |kind|
      id = kind == "curricula" ? @f.curriculum.id : kind == "modules" ? @f.modules.first.id : @f.cohort.id
      [ @f.instructor, @f.learner ].each do |user|
        clone_request(kind, id, user: user)
        assert_response :forbidden
      end
    end
    %w[curricula modules cohorts].each do |kind|
      clone_request(kind, -1)
      assert_response :not_found
    end
    assert_no_difference "AuthoringClone.count" do
      clone_request("curricula", @f.curriculum.id, client_request_id: "short")
      assert_response :unprocessable_entity
      clone_request("modules", @f.modules.first.id, curriculum_id: @f.curriculum.id, position: -1)
      assert_response :unprocessable_entity
      clone_request("cohorts", @f.cohort.id, start_date: LearningCalendar.today.iso8601, clone_curriculum: false)
      assert_response :unprocessable_entity
    end
  end

  test "late failure rolls back entire tree and receipt and allows retry" do
    models = [ Curriculum, CurriculumModule, Lesson, ContentBlock, AuthoringClone, Cohort, CohortModuleSchedule, CohortModuleSubmissionWindow, OfficeHour, PrivateMeetingConfig ]
    before = models.map(&:count)
    positions = @f.curriculum.modules.pluck(:id, :position)
    original = AuthoringClone.method(:create!)
    begin
      AuthoringClone.define_singleton_method(:create!) { |*| raise "injected failure" }
      assert_raises(RuntimeError) { service("curriculum", @f.curriculum.id).call }
      assert_raises(RuntimeError) { service("module", @f.modules.first.id, curriculum_id: @f.curriculum.id, position: 0).call }
      assert_raises(RuntimeError) { service("cohort", @f.cohort.id, start_date: (LearningCalendar.today + 60).iso8601, clone_curriculum: true).call }
    ensure
      AuthoringClone.define_singleton_method(:create!, original)
    end
    assert_equal before, models.map(&:count)
    assert_equal positions, @f.curriculum.modules.pluck(:id, :position)
    assert service("curriculum", @f.curriculum.id).call.record.draft?
    clone_request("modules", @f.modules.first.id, curriculum_id: @f.curriculum.id, position: 0)
    assert_response :conflict
    clone_request("cohorts", @f.cohort.id, start_date: (LearningCalendar.today + 30).iso8601, clone_curriculum: false)
    assert_response :conflict
  end

  test "query counts stay bounded as content and cohort configuration genuinely grow" do
    destination = Curriculum.create!(name: "Growth destination")
    measure = lambda do |label|
      {
        curriculum: count_queries { service("curriculum", @f.curriculum.id, client_request_id: "#{label}-curriculum").call },
        module: count_queries { service("module", @f.modules.first.id, curriculum_id: destination.id, position: 0, client_request_id: "#{label}-module").call },
        cohort: count_queries { service("cohort", @f.cohort.id, start_date: (LearningCalendar.today + 60).iso8601, clone_curriculum: true, client_request_id: "#{label}-cohort").call }
      }
    end
    measure.call("warm-clone")
    small = measure.call("small-clone")
    8.times do |i|
      objective = @f.curriculum.learning_objectives.create!(code: "GROW.#{i}", title: "Growth", success_criteria: "Growth")
      rubric = @f.curriculum.rubrics.create!(title: "Growth #{i}", rubric_criteria_attributes: [ { title: "Works", description: "Works correctly", learning_objective: objective } ])
      mod = @f.curriculum.modules.create!(name: "Growth #{i}", position: i + 2)
      @f.cohort.cohort_module_schedules.create!(module_id: mod.id, start_date: Date.current.next_occurring(:monday))
      @f.cohort.office_hours.create!(title: "Office #{i}", starts_at: Time.current, ends_at: 1.hour.from_now, meeting_url: "https://example.invalid/meet")
      8.times do |j|
        # Grow the first module too, for the module-clone measurement.
        owner = i.zero? ? @f.modules.first : mod
        lesson = owner.all_lessons.create!(title: "Growth #{i}-#{j}", position: j + 10, release_day: 0)
        4.times { |k| lesson.content_blocks.create!(title: "Block #{k}", block_type: :exercise, position: k, rubric: rubric) }
        block = lesson.content_blocks.create!(block_type: :checkpoint, position: 4)
        block.create_knowledge_check!(prompt: "Choose", options: %w[A B], correct_option: 0, explanation: "A is correct", learning_objective: objective)
        lesson.objective_alignments.create!(learning_objective: objective, content_block: block)
      end
    end
    assert_equal 10, @f.curriculum.modules.count
    assert_equal 68, Lesson.where(module_id: @f.curriculum.modules.select(:id)).count
    large = measure.call("large-clone")
    large.each { |kind, queries| assert_operator queries, :<=, small.fetch(kind) + 2, "#{kind}: small=#{small[kind]}, large=#{queries}" }
  end

  private

  def learner_counts
    [ Enrollment, ModuleAssignment, LessonAssignment, Progress, Submission, KnowledgeCheckAttempt, Message, CoursePurchase ].map(&:count)
  end

  def service(kind, id, **options)
    AuthoringCloneService.new(user: @admin, kind: kind, source_id: id, attributes: { name: "Synthetic clone", client_request_id: "authoring-clone-0001", **options })
  end

  def clone_request(kind, id, user: @admin, **options)
    as_user(user) { post "/api/v1/#{kind}/#{id}/clone", params: { name: "Synthetic clone", client_request_id: "authoring-clone-0001", **options }, headers: headers, as: :json }
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def as_user(person)
    payload = { "sub" => person.clerk_id, "email" => person.email, "first_name" => person.first_name, "last_name" => person.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
