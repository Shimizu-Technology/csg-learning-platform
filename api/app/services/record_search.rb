# Search only authorized relations. Never return global counts or HTML snippets.
class RecordSearch
  LIMIT = 5
  BATCH_SIZE = 50
  SCAN_LIMIT = 100
  REQUEST_SECONDS = 1.5
  # Expressions are shared verbatim with the concurrent GIN indexes.
  FIELDS = {
    "users" => %w[first_name last_name handle], "cohorts" => %w[name],
    "curricula" => %w[name description], "modules" => %w[name description],
    "lessons" => %w[title], "submissions" => %w[text notes],
    "help_requests" => %w[context_label message], "interventions" => %w[action_summary],
    "channels" => %w[name description], "messages" => %w[body],
    "announcements" => %w[title body], "recordings" => %w[title description],
    "curriculum_resources" => %w[title filename]
  }.freeze

  def initialize(viewer:, query:)
    @viewer = viewer
    @query = query.to_s.strip.first(100)
    @groups = []
    @words = @query.scan(/[[:alnum:]_]+/).select { |word| word.length >= 2 }
    @lesson_access = {}
  end

  def call
    return { groups: [] } if @viewer.nil? || @viewer.archived? || @words.empty?

    @deadline = monotonic_time + REQUEST_SECONDS
    ApplicationRecord.transaction(requires_new: true) do
      previous_timeout = ApplicationRecord.connection.select_value("SHOW statement_timeout")
      ApplicationRecord.connection.execute("SET LOCAL statement_timeout = '2s'")
      catch(:search_deadline) { search }
      ApplicationRecord.connection.execute("SET LOCAL statement_timeout = #{ApplicationRecord.connection.quote(previous_timeout)}")
    end
    { groups: @groups }.tap { |result| result[:partial] = true if @partial }
  rescue ActiveRecord::QueryCanceled
    { groups: @groups, partial: true }
  end

  private

  def search
    check_deadline!
    @cohorts = @viewer.accessible_cohorts.to_a
    @cohort_ids = @cohorts.map(&:id)
    @school = FeatureSwitches.school
    @enrollments = @viewer.staff? ? [] : @viewer.enrollments.with_read_access.includes(*LessonReadAccess::ENROLLMENT_INCLUDES, module_assignments: :curriculum_module, lesson_assignments: :lesson).order(enrolled_at: :desc, id: :desc).to_a
    @curriculum_ids = @cohorts.map(&:curriculum_id).uniq
    people
    add("cohort", matched(Cohort.where(id: @cohort_ids), "name")) { |r| row(r, r.name, "cohort", context: { staff: @viewer.staff? }) }
    curricula = @viewer.admin? ? Curriculum.all : Curriculum.where(id: @curriculum_ids)
    # A cohort copy names its cohort only for viewers who can see it (CurriculumName).
    names = CurriculumName.new(@viewer)
    add("curriculum", matched(curricula, "name"), prepare: ->(batch) { names.preload(batch.map(&:id)) }) { |r| row(r, names.for(r), "curriculum", context: { staff: @viewer.staff?, cohort_id: @cohorts.find { |c| c.curriculum_id == r.id }&.id }) }
    learning
    work
    conversations
    updates
    resources
  end

  def matched(scope, title)
    table = scope.klass.arel_table
    tokens = @words.map { |word| "#{word}:*" }.join(" & ")
    return scope.none if tokens.empty?

    columns = FIELDS.fetch(scope.klass.table_name).map { |column| function("coalesce", table[column], quoted("")) }
    document = columns.reduce { |left, right| Arel::Nodes::InfixOperation.new("||", Arel::Nodes::InfixOperation.new("||", left, quoted(" ")), right) }
    vector = function("to_tsvector", quoted("simple"), document)
    tsquery = function("to_tsquery", quoted("simple"), quoted(tokens))
    exact = function("lower", table[title]).eq(@query.downcase.delete_prefix("@"))
    if scope.klass == User
      handle = function("lower", table[:handle]).eq(@query.downcase.delete_prefix("@"))
      name = function("lower", function("concat_ws", quoted(" "), table[:first_name], table[:last_name])).eq(@query.downcase)
      exact = exact.or(handle).or(name)
    end
    predicate = Arel::Nodes::InfixOperation.new("@@", vector, tsquery)
    priority = Arel::Nodes::Case.new.when(exact).then(0).else(1)
    rank = function("ts_rank", vector, tsquery)
    scope.where(predicate).reorder(priority.asc, rank.desc, table[:id].asc)
  end

  def function(name, *arguments)
    Arel::Nodes::NamedFunction.new(name, arguments)
  end

  def quoted(value)
    Arel::Nodes.build_quoted(value)
  end

  def monotonic_time
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def check_deadline!
    return if monotonic_time < @deadline

    @partial = true
    throw :search_deadline
  end

  # Keyset over the same exact-match/rank/id ordering shown to the client.
  # Bound authorization work even when every candidate is locked.
  def add(type, records, prepare: nil)
    results = []
    scanned = 0
    cursor = nil
    begin
      loop do
        check_deadline!
        scope = records
        if cursor
          priority, rank = records.order_values.first(2).map(&:expr)
          id = records.klass.arel_table[:id]
          rank_cursor = function("CAST", Arel::Nodes::As.new(quoted(cursor.search_rank), Arel.sql("real")))
          scope = scope.where(priority.gt(cursor.search_priority)
            .or(priority.eq(cursor.search_priority).and(rank.lt(rank_cursor)))
            .or(priority.eq(cursor.search_priority).and(rank.eq(rank_cursor)).and(id.gt(cursor.id))))
        end
        size = @viewer.staff? ? LIMIT : [ records.limit_value || BATCH_SIZE, BATCH_SIZE ].min
        if records.order_values.size == 3
          priority, rank = records.order_values.first(2).map(&:expr)
          scope = scope.select(records.klass.arel_table[Arel.star], priority.as("search_priority"), rank.as("search_rank"))
        end
        batch = scope.limit(size).to_a
        break if batch.empty?

        check_deadline!
        prepare&.call(batch)
        batch.each do |record|
          check_deadline!
          result = yield(record)
          results << result if result
          break if results.size == LIMIT
        end
        scanned += batch.size
        break if @viewer.staff? || results.size == LIMIT || batch.size < size
        if scanned >= SCAN_LIMIT
          @partial = true
          break
        end
        cursor = batch.last
      end
    ensure
      @groups << { type: type, results: results } if results.any?
    end
  end

  def row(record, title, kind, context: {}, anchor: {}, snippet: nil, id: record.id)
    destination = RecordDestination.build(kind: kind, id: id, context: context, anchor: anchor)
    { id: record.id.to_s, title: plain(title), snippet: plain(snippet || title), destination: destination }
  end

  def plain(value)
    Loofah.fragment(value.to_s).text(encode_special_chars: false).gsub(/[[:space:]]+/, " ").strip.first(180)
  end

  def enabled(key)
    @cohorts.select { |c| FeatureSwitches.for(cohort: c, school: @school)[key] }.map(&:id)
  end

  def people
    if @viewer.staff?
      students = User.where(role: :student)
      students = students.where(id: Enrollment.where(cohort_id: @cohort_ids).select(:user_id)) unless @viewer.admin?
      add("student", matched(students, "first_name").limit(LIMIT)) { |r| row(r, r.full_name, "student", snippet: r.handle) }
    end
    # Team is an admin-only record destination; learners do not get a directory.
    if @viewer.admin?
      add("staff", matched(User.where(role: [ :admin, :instructor ]), "first_name").limit(LIMIT)) { |r| row(r, r.full_name, "staff", snippet: r.handle) }
    end
  end

  def learning
    mods = @viewer.admin? ? CurriculumModule.all : CurriculumModule.where(curriculum_id: @curriculum_ids)
    add("lesson", matched(Lesson.where(module_id: mods.select(:id)).includes(:curriculum_module), "title")) do |r|
      access = lesson_access(r)
      next unless access.allowed?

      row(r, r.title, "lesson", context: { cohort_id: access.enrollment&.cohort_id })
    end
    module_lessons = {}
    prepare_modules = unless @viewer.staff?
      lambda do |batch|
        module_lessons = Lesson.active.where(module_id: batch.map(&:id)).reorder(nil).to_a.group_by(&:module_id)
        batch.each do |mod|
          module_lessons.fetch(mod.id, []).each { |lesson| lesson.association(:curriculum_module).target = mod }
        end
      end
    end
    add("module", matched(mods, "name"), prepare: prepare_modules) do |r|
      enrollment = @enrollments.find do |e|
        next false unless e.cohort.curriculum_id == r.curriculum_id

        assignment = e.module_assignments.find { |a| a.module_id == r.id }
        assigned = e.module_reachable_for_read?(assignment) || e.lesson_assignments.any? { |a| a.lesson.module_id == r.id && !a.lesson.archived? && a.lesson.published? }
        lessons = module_lessons.fetch(r.id, [])
        assigned && (lessons.empty? || lessons.any? do |lesson|
          check_deadline!
          lesson_assignment = e.lesson_assignments.find { |a| a.lesson_id == lesson.id }
          LessonReadAccess.readable?(e, lesson, assignment, lesson_assignment)
        end)
      end unless @viewer.staff?
      next unless @viewer.staff? || enrollment

      row(r, r.name, "module", context: { cohort_id: enrollment&.cohort_id })
    end
  end

  def lesson_access(lesson)
    return LessonReadAccess::Result.new(enrollment: nil, error: nil) if @viewer.staff?

    @lesson_access[lesson.id] ||= begin
      enrollment = @enrollments.find do |e|
        next false unless e.cohort.curriculum_id == lesson.curriculum_module.curriculum_id

        assignment = e.module_assignments.find { |a| a.module_id == lesson.module_id }
        lesson_assignment = e.lesson_assignments.find { |a| a.lesson_id == lesson.id }
        LessonReadAccess.readable?(e, lesson, assignment, lesson_assignment)
      end
      LessonReadAccess::Result.new(enrollment: enrollment, error: enrollment ? nil : LessonReadAccess::NOT_ACCESSIBLE)
    end
  end

  def readable_lesson?(id)
    lesson = Lesson.find_by(id: id)
    lesson && lesson_access(lesson).allowed?
  end

  def readable_recording(id)
    recording = Recording.where(cohort_id: enabled("recordings")).find_by(id: id)
    enrollment = @enrollments.find { |e| e.cohort_id == recording&.cohort_id }
    recording if recording && (@viewer.staff? || enrollment&.recording_available_for_read?(recording))
  end

  def work
    enrollments = Enrollment.where(cohort_id: @cohort_ids)
    enrollments = enrollments.where(user_id: @viewer.id) unless @viewer.staff?
    submissions = matched(Submission.where(enrollment_id: enrollments.select(:id)).includes(content_block: :lesson), "text")
    add("submission", submissions) do |r|
      if @viewer.staff?
        row(r, "Submission ##{r.id}", "submission", snippet: r.text || r.notes)
      elsif lesson_access(r.content_block.lesson).allowed?
        row(r, "Submission ##{r.id}", "lesson", id: r.content_block.lesson_id, context: { cohort_id: @enrollments.find { |e| e.id == r.enrollment_id }&.cohort_id }, anchor: { block_id: r.content_block_id }, snippet: r.text || r.notes)
      end
    end
    help = HelpRequest.where(cohort_id: enabled("help_requests"))
    help = help.where(student_id: @viewer.id) unless @viewer.staff?
    add("help_request", matched(help, "context_label")) do |r|
      if @viewer.staff?
        row(r, r.context_label, "help_request", snippet: r.message)
      else
        target = RecordDestination.from_path(r.context_path)
        next unless target
        if target[:kind] == "lesson"
          next unless readable_lesson?(target[:id])
        elsif target[:kind] == "recording"
          recording = readable_recording(target[:id])
          next unless recording && recording.cohort_id == r.cohort_id
        else
          next
        end
        row(r, r.context_label, target[:kind], id: target[:id], context: { cohort_id: r.cohort_id }, anchor: target[:anchor], snippet: r.message)
      end
    end
    return unless @viewer.staff?

    plans = Intervention.where(enrollment_id: enrollments.where(cohort_id: enabled("interventions")).select(:id))
    add("follow_up", matched(plans, "action_summary").limit(LIMIT)) { |r| row(r, r.action_summary || "Follow-up plan", "follow_up") }
  end

  def conversations
    channels = Channel.visible_for(@viewer)
    add("channel", matched(channels, "name").limit(LIMIT)) { |r| row(r, r.name, "channel", snippet: r.description) }
    directs = DirectConversation.visible_for(@viewer)
    # Find conversations by members' indexed names/handles, never a nonmember DM.
    member_ids = matched(User.all, "first_name").select(:id)
    dm_ids = DirectConversationMember.where(user_id: member_ids).select(:direct_conversation_id)
    add("dm", directs.where(id: dm_ids).includes(:users).order(:id).limit(LIMIT)) { |r| row(r, r.title_for(@viewer), "dm") }
    messages = Message.visible.where(channel_id: channels.select(:id)).or(Message.visible.where(direct_conversation_id: directs.select(:id)))
    blocked = @viewer.blocked_relationship_user_ids - [ @viewer.id ]
    messages = messages.where.not(author_id: blocked)
    add("message", matched(messages, "body").limit(LIMIT)) do |r|
      row(r, "Message", r.channel_id ? "channel" : "dm", id: r.channel_id || r.direct_conversation_id, anchor: { message_id: r.id }, snippet: r.body)
    end
  end

  def updates
    announcements = Announcement.visible_for(@viewer).where(cohort_id: enabled("announcements") + (@school["announcements"] ? [ nil ] : []))
    add("announcement", matched(announcements, "title").limit(LIMIT)) { |r| row(r, r.title, "announcement", snippet: r.body) }
    recordings = matched(Recording.where(cohort_id: enabled("recordings")), "title")
    add("recording", recordings) do |r|
      enrollment = @enrollments.find { |e| e.cohort_id == r.cohort_id }
      next unless @viewer.staff? || enrollment&.recording_available_for_read?(r)

      row(r, r.title, "recording", context: { cohort_id: r.cohort_id }, snippet: r.description)
    end
  end

  def resources
    resource_cohorts = @viewer.staff? ? @cohorts.select { |c| c.active? || c.upcoming? } : @cohorts
    files = matched(CurriculumResource.ready.where(curriculum_id: resource_cohorts.map(&:curriculum_id)), "title")
    add("resource", files) do |r|
      next unless @viewer.staff? || @enrollments.any? { |e| e.cohort.curriculum_id == r.curriculum_id && e.resource_available_for_read?(r) }

      row(r, r.title, "resource", context: { cohort_id: @cohorts.find { |c| c.curriculum_id == r.curriculum_id }&.id, query: plain(r.title) }, snippet: r.filename)
    end
    check_deadline!
    links = resource_cohorts.flat_map do |cohort|
      check_deadline!
      enrollment = @enrollments.find { |e| e.cohort_id == cohort.id }
      next [] unless @viewer.staff? || enrollment
      cohort.class_resources_for_read(enrollment).filter_map.with_index do |resource, index|
        check_deadline!
        text = [ resource["title"], resource["description"] ].join(" ")
        next unless @words.all? { |word| plain(text).downcase.include?(word.downcase) }
        row(cohort, resource["title"], "resource", id: index + 1, context: { cohort_id: cohort.id, query: plain(resource["title"]) }, snippet: resource["description"]).merge(id: "link-#{cohort.id}-#{index}")
      end
    end
    if links.any?
      group = @groups.find { |g| g[:type] == "resource" }
      results = ((group && group[:results]) || []) + links
      results = results.sort_by { |result| result[:title].casecmp?(plain(@query)) ? 0 : 1 }.first(LIMIT)
      group ? group[:results] = results : @groups << { type: "resource", results: results }
    end
  end
end
