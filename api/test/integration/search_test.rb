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
    @cohort_file = @cohort.cohort_files.create!(kind: "doc", title: "Synthetic drive doc", folder: "Slides", doc_content: "# Notes", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor)
  end

  test "authorization matrix for every searchable type and populated contract" do
    expected = %w[student staff cohort curriculum module lesson submission help_request follow_up channel dm message announcement recording resource cohort_file]
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

  test "cohort file search respects privacy, staff-only staging, and pause cutoffs" do
    classmate = person("filemate", :student)
    Enrollment.create!(user: classmate, cohort: @cohort, status: :active)
    @cohort.cohort_files.create!(kind: "doc", title: "Privatefile classmate doc", folder: "Career", student: classmate, doc_content: "secret", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: classmate)
    @cohort.cohort_files.create!(kind: "doc", title: "Stagedfile staff doc", folder: "Slides", visibility: "staff_only", doc_content: "draft", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor)
    own = @cohort.cohort_files.create!(kind: "doc", title: "Ownfile portfolio plan", folder: "Career", student: @student, doc_content: "mine", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @student)

    search(@student, "Privatefile")
    assert_empty groups
    search(@student, "Stagedfile")
    assert_empty groups
    search(@instructor, "Stagedfile")
    assert_equal 1, groups.fetch("cohort_file").size
    search(@student, "Ownfile")
    assert_equal [ own.id.to_s ], groups.fetch("cohort_file").map { |r| r["id"] }
    assert_equal "/resources?cohort_id=#{@cohort.id}&file=#{own.id}", RecordDestination.to_web_path(groups.fetch("cohort_file").first["destination"])

    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: 2.days.ago, read_cutoff_at: 2.days.ago)
    own.update_columns(created_at: 1.day.ago, shared_at: 1.day.ago, doc_updated_at: 1.day.ago)
    search(@student, "Ownfile")
    refute groups.key?("cohort_file")

    # Pre-pause file with a post-pause version rename, title edit, and folder rename:
    # only the pre-pause filename matches; post-pause title/folder never match or render.
    versioned = @cohort.cohort_files.create!(
      kind: "file", title: "Postpausetitle", folder: "Postpausefolder", filename: "embargoed.pdf", content_type: "application/pdf", file_size: 123,
      s3_key: "cohort_files/cohort_#{@cohort.id}/shared/v2/embargoed.pdf", upload_key: "cohort_file_uploads/v2", upload_expires_at: 1.day.from_now,
      version_number: 2, ready: true, ready_at: 1.day.ago, shared_at: 5.days.ago, created_at: 5.days.ago, updated_at: 1.day.ago, uploaded_by: @instructor
    )
    versioned.versions.create!(
      version_number: 1, filename: "original.pdf", content_type: "application/pdf", file_size: 100,
      s3_key: "cohort_files/cohort_#{@cohort.id}/shared/v1/original.pdf", upload_key: "cohort_file_uploads/v1", upload_expires_at: 1.day.from_now,
      ready: true, ready_at: 4.days.ago, created_at: 4.days.ago, uploaded_by: @instructor
    )
    %w[embargoed Postpausetitle Postpausefolder].each do |leaked|
      search(@student, leaked)
      refute groups.key?("cohort_file"), "expected #{leaked} not to match after pause"
    end
    search(@student, "original")
    assert_equal [ versioned.id.to_s ], groups.fetch("cohort_file").map { |r| r["id"] }
    assert_equal "original.pdf", groups.fetch("cohort_file").first["title"]
    assert_equal "original.pdf", groups.fetch("cohort_file").first["snippet"]

    # Pre-pause Learn Doc renamed and moved to a new folder after pause: old title matches,
    # post-pause title and folder never match or render.
    renamed_doc = @cohort.cohort_files.create!(
      kind: "doc", title: "Postpauseheading", folder: "Postpausedocfolder", doc_content: "v2", doc_version: 2,
      doc_updated_at: 1.day.ago, shared_at: 5.days.ago, created_at: 5.days.ago, updated_at: 1.day.ago, ready: true, uploaded_by: @instructor
    )
    renamed_doc.doc_revisions.create!(revision_number: 1, title: "Prepauseheading", content: "v1", created_at: 4.days.ago, edited_by: @instructor)
    %w[Postpauseheading Postpausedocfolder].each do |leaked|
      search(@student, leaked)
      refute groups.key?("cohort_file"), "expected #{leaked} not to match after pause"
    end
    search(@student, "Prepauseheading")
    assert_equal [ renamed_doc.id.to_s ], groups.fetch("cohort_file").map { |r| r["id"] }
    assert_equal "Prepauseheading", groups.fetch("cohort_file").first["title"]
    assert_equal "Learn Doc", groups.fetch("cohort_file").first["snippet"]

    # Mixed active + paused cohorts preserve ts_rank order among active matches.
    active_cohort = Cohort.create!(curriculum: @curriculum, name: "Active rank cohort", start_date: 14.days.ago.to_date, status: :active)
    Enrollment.create!(user: @student, cohort: active_cohort, status: :active, joined_at: 1.day.ago)
    low_rank = active_cohort.cohort_files.create!(
      kind: "doc", title: "Rankmerge overview notes", folder: "General", doc_content: "x", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor
    )
    high_rank = active_cohort.cohort_files.create!(
      kind: "doc", title: "Rankmerge rankmerge rankmerge", folder: "Rankmerge", doc_content: "x", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor
    )
    paused_match = @cohort.cohort_files.create!(
      kind: "doc", title: "Rankmerge paused archive", folder: "Slides", doc_content: "x",
      doc_updated_at: 4.days.ago, shared_at: 5.days.ago, created_at: 5.days.ago, updated_at: 4.days.ago, ready: true, uploaded_by: @instructor
    )
    search(@student, "Rankmerge")
    ranked_ids = groups.fetch("cohort_file").map { |r| r["id"] }
    assert_includes ranked_ids, paused_match.id.to_s
    assert_operator ranked_ids.index(high_rank.id.to_s), :<, ranked_ids.index(low_rank.id.to_s)

    # Exact-match priority strips a leading @ identically for active and paused cohorts.
    paused_exact = @cohort.cohort_files.create!(
      kind: "doc", title: "Atmatch", folder: "Slides", doc_content: "x",
      doc_updated_at: 4.days.ago, shared_at: 5.days.ago, created_at: 5.days.ago, updated_at: 4.days.ago, ready: true, uploaded_by: @instructor
    )
    active_partial = active_cohort.cohort_files.create!(
      kind: "doc", title: "Atmatch atmatch atmatch", folder: "Atmatch", doc_content: "x",
      doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor
    )
    search(@student, "@Atmatch")
    at_ids = groups.fetch("cohort_file").map { |r| r["id"] }
    assert_equal [ paused_exact.id.to_s, active_partial.id.to_s ], at_ids

    # Underscore-separated titles match identically in active and paused cohorts via PostgreSQL @@.
    paused_under = @cohort.cohort_files.create!(
      kind: "doc", title: "budget_notes", folder: "Slides", doc_content: "x",
      doc_updated_at: 4.days.ago, shared_at: 5.days.ago, created_at: 5.days.ago, updated_at: 4.days.ago, ready: true, uploaded_by: @instructor
    )
    active_under = active_cohort.cohort_files.create!(
      kind: "doc", title: "budget_notes", folder: "Slides", doc_content: "x",
      doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor
    )
    search(@student, "notes")
    under_ids = groups.fetch("cohort_file").map { |r| r["id"] }
    assert_includes under_ids, paused_under.id.to_s
    assert_includes under_ids, active_under.id.to_s
  end

  test "staff cohort file search excludes archived owners and applies eligibility before the limit" do
    archived_student = person("archivedfile", :student)
    archived_student.update!(archived_at: 1.hour.ago)
    Enrollment.create!(user: archived_student, cohort: @cohort, status: :active)
    @cohort.cohort_files.create!(kind: "doc", title: "Archivedownerfile", folder: "Career", student: archived_student, doc_content: "x", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor)
    search(@instructor, "Archivedownerfile")
    refute groups.key?("cohort_file")

    dropped_student = person("droppedfile", :student)
    Enrollment.create!(user: dropped_student, cohort: @cohort, status: :dropped)
    6.times do |n|
      @cohort.cohort_files.create!(kind: "doc", title: "Ranktest", folder: "Career #{n}", student: dropped_student, doc_content: "x", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor)
    end
    class_doc = @cohort.cohort_files.create!(kind: "doc", title: "Ranktest class guide", folder: "Slides", doc_content: "x", doc_updated_at: 1.hour.ago, ready: true, uploaded_by: @instructor)
    search(@instructor, "Ranktest")
    assert_equal [ class_doc.id.to_s ], groups.fetch("cohort_file").map { |r| r["id"] }
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

  test "a nonempty module with no available lesson is not searchable" do
    @lesson.update!(release_day: 999)
    search(@student, "Synthetic module")
    refute groups.key?("module")
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
    @cohort.update!(settings: { class_resources: [ { title: "Synthetic longer", url: "https://example.invalid/longer" }, { title: "Synthetic", url: "https://example.invalid/exact" } ] })
    search(@admin, "Synthetic")
    assert_equal @cohort.id.to_s, groups.fetch("cohort").first["id"]
    assert_equal @student.id.to_s, groups.fetch("student").first["id"]
    refute_includes groups.fetch("announcement").first["snippet"], "<"
    assert_equal "Synthetic", groups.fetch("resource").first["title"]
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

  test "blocked message authors are excluded in both directions but own messages remain" do
    message = Message.create!(channel: @channel, author: @instructor, body: "Blockedneedle private")
    own = Message.create!(channel: @channel, author: @student, body: "Blockedneedle own")
    [ [ @student, @instructor ], [ @instructor, @student ] ].each do |blocker, blocked|
      block = UserBlock.create!(blocker: blocker, blocked_user: blocked)
      search(@student, "Blockedneedle")
      assert_equal [ own.id.to_s ], groups.fetch("message").map { |r| r["id"] }
      refute_includes response.body, message.body
      block.destroy!
    end
  end

  test "deleted messages drafts and staff channels are not learner results" do
    Message.create!(channel: @channel, author: @student, body: "Secretneedle deleted", deleted_at: Time.current)
    staff_channel = @cohort.workspace.channels.create!(name: "Secretneedle staff", visibility: :staff_only)
    Message.create!(channel: staff_channel, author: @instructor, body: "Secretneedle staff message")
    @recording.update!(status: :draft, title: "Secretneedle draft")
    Announcement.create!(author: @instructor, cohort: @cohort, audience: :cohort, title: "Secretneedle draft", body: "Draft body", status: :draft)
    search(@student, "Secretneedle")
    assert_empty groups
  end

  test "a draft update is found by nobody, its author and admins included" do
    Announcement.create!(author: @instructor, cohort: @cohort, audience: :cohort, title: "Draftneedle plan", body: "Draft body", status: :draft)
    [ @student, @instructor, @admin ].each do |viewer|
      search(viewer, "Draftneedle")
      assert_nil groups["announcement"], "#{viewer.role} found a draft"
    end
  end

  test "module assignment and readable enrollment are required even for empty modules" do
    empty = CurriculumModule.create!(curriculum: @curriculum, name: "Emptyneedle", position: 2)
    search(@student, "Emptyneedle")
    assert_empty groups
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: empty, unlocked: true)
    search(@student, "Emptyneedle")
    assert_equal empty.id.to_s, groups.fetch("module").first["id"]
    @enrollment.update!(status: :dropped)
    search(@student, "Emptyneedle")
    assert_empty groups
  end

  test "paused read cutoffs exclude newer lessons recordings and resources" do
    @cohort.update!(settings: {})
    cutoff = 3.days.ago
    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: cutoff, read_cutoff_at: cutoff)
    search(@student, "Synthetic")
    %w[lesson recording resource].each { |type| refute groups.key?(type), type }
    old = 5.days.ago
    @lesson.update_columns(created_at: old)
    @enrollment.module_assignments.first.update_columns(created_at: old, updated_at: old, availability_changed_at: old)
    @recording.update_columns(created_at: old, published_at: old)
    @file.update_columns(created_at: old, ready_at: old)
    search(@student, "Synthetic")
    %w[lesson recording resource].each { |type| assert groups.key?(type), type }
  end

  test "entities are decoded and short query words are ignored individually" do
    @file.update!(title: "Synthetic & student's guide")
    search(@student, "a Synthetic x")
    assert groups.key?("lesson")
    file = groups.fetch("resource").find { |r| r["id"] == @file.id.to_s }
    assert_equal "Synthetic & student's guide", file["title"]
    refute_match(/&amp;|&#39;/, response.body)
    search(@student, "a b c")
    assert_empty groups
  end

  test "encoded entities are plain text and exact resource names rank first" do
    @update.update!(title: "Synthetic &amp; guide", body: "Synthetic &#39;quoted&#39; &amp; safe")
    @cohort.update!(settings: { class_resources: [
      { title: "Synthetic & guide extended", url: "https://example.invalid/long" },
      { title: "Synthetic &amp; guide", url: "https://example.invalid/exact" }
    ] })
    search(@student, "Synthetic & guide")
    assert_equal "Synthetic & guide", groups.fetch("resource").first["title"]
    assert_equal "Synthetic & guide", groups.fetch("announcement").first["title"]
    assert_equal "Synthetic 'quoted' & safe", groups.fetch("announcement").first["snippet"]
    refute_match(/&amp;|&#39;/, response.body)
  end

  test "staff matching queries have SQL limits and stay fast on a larger lesson set" do
    now = Time.current
    Lesson.insert_all!(1000.times.map { |n| { module_id: @module.id, title: "Synthetic bulk #{n}", position: n + 1, release_day: 0, created_at: now, updated_at: now } })
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] if payload[:sql].include?("@@") }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    result = nil
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { result = RecordSearch.new(viewer: @admin, query: "Synthetic").call }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 2.5
    assert result[:groups].any?
    assert queries.any?
    assert queries.all? { |sql| sql.include?("LIMIT") }, queries.inspect
    before = count_queries(@admin)
    Lesson.insert_all!(100.times.map { |n| { module_id: @module.id, title: "Synthetic more #{n}", position: n + 1001, release_day: 0, created_at: now, updated_at: now } })
    assert_equal before, count_queries(@admin)
  end

  test "learner batches continue past unavailable matching rows" do
    @lesson.update!(release_day: 999)
    60.times { |n| Lesson.create!(curriculum_module: @module, title: "Synthetic hidden #{n}", position: n + 1, release_day: 999) }
    released = Lesson.create!(curriculum_module: @module, title: "Synthetic released", position: 80, release_day: 0)
    search(@student, "Synthetic")
    assert_equal [ released.id.to_s ], groups.fetch("lesson").map { |r| r["id"] }
  end

  test "a statement timeout returns completed groups and restores connection settings" do
    service = RecordSearch.new(viewer: @admin, query: "Synthetic")
    service.define_singleton_method(:learning) { ApplicationRecord.connection.execute("SELECT pg_sleep(3)") }
    before = ApplicationRecord.connection.select_value("SHOW statement_timeout")
    result = service.call
    assert_equal true, result[:partial]
    assert result[:groups].any? { |g| g[:type] == "curriculum" }
    assert_equal before, ApplicationRecord.connection.select_value("SHOW statement_timeout")
  end

  test "dropped enrollment cannot unlock another active cohort on the same curriculum" do
    active = Cohort.create!(curriculum: @curriculum, name: "Other active", start_date: 14.days.ago, status: :active)
    Enrollment.create!(user: @student, cohort: active, status: :active)
    @enrollment.update!(status: :dropped)
    search(@student, "Synthetic lesson")
    refute groups.key?("lesson")
  end

  test "own help requests cannot reveal draft or post cutoff recordings" do
    @help.update!(context_type: :recording, context_id: @recording.id, context_path: "/recordings?recording=#{@recording.id}")
    search(@student, "Synthetic question")
    assert groups.key?("help_request")
    @recording.update!(status: :draft)
    search(@student, "Synthetic question")
    refute groups.key?("help_request")
    @recording.update!(status: :published)
    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: 3.days.ago, read_cutoff_at: 3.days.ago)
    search(@student, "Synthetic question")
    refute groups.key?("help_request")
  end

  test "nonbreaking spaces and named entities become plain whitespace" do
    @update.update!(title: "Synthetic&nbsp;guide", body: "Synthetic&nbsp; &copy;  guide")
    search(@student, "Synthetic")
    assert_equal "Synthetic guide", groups.fetch("announcement").first["title"]
    assert_equal "Synthetic © guide", groups.fetch("announcement").first["snippet"]
  end

  test "whole request deadline returns completed groups and partial" do
    service = RecordSearch.new(viewer: @student, query: "Synthetic")
    clock = 0
    service.define_singleton_method(:monotonic_time) { clock += 0.1 }
    result = service.call
    assert_equal true, result[:partial]
    assert result[:groups].any?
  end

  test "locked learner matches use bounded queries and keyset pages on a big set" do
    now = Time.current
    mods = CurriculumModule.insert_all!(300.times.map { |n| { curriculum_id: @curriculum.id, name: "The locked #{n}", position: n + 1, created_at: now, updated_at: now } }, returning: %w[id]).rows.flatten
    ModuleAssignment.insert_all!(mods.map { |id| { enrollment_id: @enrollment.id, module_id: id, unlocked: true, created_at: now, updated_at: now } })
    Lesson.insert_all!(mods.flat_map { |id| 4.times.map { |n| { module_id: id, title: "The locked lesson #{n}", position: n, release_day: 999, created_at: now, updated_at: now } } })
    count_queries(@student)
    %w[th the].each do |query|
      queries = []
      result = nil
      callback = ->(*, payload) { queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:cached] }
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { result = RecordSearch.new(viewer: @student.reload, query: query).call }
      elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      puts "Learner #{query}: #{elapsed.round(3)}s, #{queries.size} queries (300 modules, 1200 locked lessons)"
      assert_equal true, result[:partial]
      refute result[:groups].any? { |group| %w[lesson module].include?(group[:type]) }
      assert_operator queries.size, :<, 100
      assert_operator elapsed, :<, 1
      refute queries.any? { |sql| sql.include?("OFFSET") }
    end
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
