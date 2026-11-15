# Search only authorized relations. Never return global counts or HTML snippets.
class RecordSearch
  LIMIT = 5
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
  end

  def call
    return { groups: [] } if @viewer.nil? || @viewer.archived? || @query.length < 2

    @cohorts = @viewer.accessible_cohorts.to_a
    @cohort_ids = @cohorts.map(&:id)
    @school = FeatureSwitches.school
    @enrollments = @viewer.enrollments.with_read_access.includes(*LessonReadAccess::ENROLLMENT_INCLUDES, lesson_assignments: :lesson).order(enrolled_at: :desc, id: :desc).to_a
    @curriculum_ids = @cohorts.map(&:curriculum_id).uniq
    people
    add("cohort", matched(Cohort.where(id: @cohort_ids), "name")) { |r| row(r, r.name, "cohort", context: { staff: @viewer.staff? }) }
    curricula = @viewer.admin? ? Curriculum.all : Curriculum.where(id: @curriculum_ids)
    add("curriculum", matched(curricula, "name")) { |r| row(r, r.name, "curriculum", context: { staff: @viewer.staff?, cohort_id: @cohorts.find { |c| c.curriculum_id == r.id }&.id }) }
    learning
    @readable_recordings = Recording.where(cohort_id: enabled("recordings")).to_a.select do |recording|
      enrollment = @enrollments.find { |e| e.cohort_id == recording.cohort_id }
      @viewer.staff? || enrollment&.recording_available_for_read?(recording)
    end.index_by(&:id)
    work
    conversations
    updates
    resources
    { groups: @groups }
  end

  private

  def matched(scope, title)
    table = scope.klass.arel_table
    tokens = @query.scan(/[[:alnum:]_]+/).map { |word| "#{word}:*" }.join(" & ")
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
    scope.where(predicate).reorder(Arel::Nodes::Case.new.when(exact).then(0).else(1), function("ts_rank", vector, tsquery).desc, table[:id].asc)
  end

  def function(name, *arguments)
    Arel::Nodes::NamedFunction.new(name, arguments)
  end

  def quoted(value)
    Arel::Nodes.build_quoted(value)
  end

  # Cap after authorization, including release/read-cutoff checks.
  def add(type, records)
    results = []
    records.each do |record|
      result = yield(record)
      results << result if result
      break if results.size == LIMIT
    end
    @groups << { type: type, results: results } if results.any?
  end

  def row(record, title, kind, context: {}, anchor: {}, snippet: nil, id: record.id)
    destination = RecordDestination.build(kind: kind, id: id, context: context, anchor: anchor)
    { id: record.id.to_s, title: plain(title), snippet: plain(snippet || title), destination: destination }
  end

  def plain(value)
    ActionController::Base.helpers.strip_tags(value.to_s).gsub(/\s+/, " ").strip.first(180)
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
    lessons = Lesson.where(module_id: mods.select(:id)).includes(:curriculum_module).to_a
    access = LessonReadAccess.check_many(@viewer, lessons, across_cohorts: true)
    allowed = lessons.select { |lesson| access.fetch(lesson.id).allowed? }
    add("lesson", matched(Lesson.where(id: allowed.map(&:id)), "title").limit(LIMIT)) do |r|
      cohort = access.fetch(r.id).enrollment&.cohort_id
      row(r, r.title, "lesson", context: { cohort_id: cohort })
    end
    @allowed_lessons = allowed.index_by(&:id)
    add("module", matched(mods, "name")) do |r|
      enrollment = @enrollments.find do |e|
        next false unless e.cohort.curriculum_id == r.curriculum_id

        assignment = e.module_assignments.find { |a| a.module_id == r.id }
        assignment&.accessible?(e.cohort) || e.lesson_assignments.any? { |a| a.lesson.module_id == r.id && !a.lesson.archived? }
      end unless @viewer.staff?
      next unless @viewer.staff? || enrollment

      row(r, r.name, "module", context: { cohort_id: enrollment&.cohort_id })
    end
  end

  def work
    enrollments = Enrollment.where(cohort_id: @cohort_ids)
    enrollments = enrollments.where(user_id: @viewer.id) unless @viewer.staff?
    submissions = matched(Submission.where(enrollment_id: enrollments.select(:id)).includes(content_block: :lesson), "text")
    add("submission", submissions) do |r|
      if @viewer.staff?
        row(r, "Submission ##{r.id}", "submission", snippet: r.text || r.notes)
      elsif @allowed_lessons.key?(r.content_block.lesson_id)
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
          next unless @allowed_lessons.key?(target[:id].to_i)
        elsif target[:kind] == "recording"
          recording = @readable_recordings[target[:id].to_i]
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
    add("message", matched(messages, "body").limit(LIMIT)) do |r|
      row(r, "Message", r.channel_id ? "channel" : "dm", id: r.channel_id || r.direct_conversation_id, anchor: { message_id: r.id }, snippet: r.body)
    end
  end

  def updates
    announcements = Announcement.visible_for(@viewer).where(cohort_id: enabled("announcements") + (@school["announcements"] ? [ nil ] : []))
    add("announcement", matched(announcements, "title").limit(LIMIT)) { |r| row(r, r.title, "announcement", snippet: r.body) }
    recordings = matched(Recording.where(id: @readable_recordings.keys), "title")
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

      row(r, r.title, "resource", context: { cohort_id: @cohorts.find { |c| c.curriculum_id == r.curriculum_id }&.id, query: r.title }, snippet: r.filename)
    end
    links = resource_cohorts.flat_map do |cohort|
      enrollment = @enrollments.find { |e| e.cohort_id == cohort.id }
      next [] unless @viewer.staff? || enrollment
      cohort.class_resources_for_read(enrollment).filter_map.with_index do |resource, index|
        text = [ resource["title"], resource["description"] ].join(" ")
        next unless text.downcase.include?(@query.downcase)
        row(cohort, resource["title"], "resource", id: index + 1, context: { cohort_id: cohort.id, query: resource["title"] }, snippet: resource["description"]).merge(id: "link-#{cohort.id}-#{index}")
      end
    end
    if links.any?
      group = @groups.find { |g| g[:type] == "resource" }
      results = ((group && group[:results]) || []) + links
      results = results.sort_by { |result| result[:title].casecmp?(@query) ? 0 : 1 }.first(LIMIT)
      group ? group[:results] = results : @groups << { type: "resource", results: results }
    end
  end
end
