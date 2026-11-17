# The redesigned student Today (W8 PR 8.2; mockup 07-student-today.html): one
# next action, what needs the learner, what waits on an instructor, recent
# grades, the next live session and, for a learner behind schedule, how far
# behind they are and their agreed catch-up plan. The dashboard adds it as
# `today` only when the cohort's `student_experience_v2` switch is on, so the
# payload of a cohort with it off is unchanged.
#
# Every status, count and next step comes from LearnerProgress: the next
# lesson, overall counts, this week, the pace (U-5.1) and the submission lists
# (through MyWork, so Today's counts match My work's lists).
#
# Catch-up (Leon, decision 4): a learner sees an agreed plan only. A plan is
# agreed when staff saved it (an active learning plan with the learning_plans
# switch on); the student sees its target date and who saved it last and when.
# Until then a learner behind schedule sees how far behind they are and is
# offered to ask their instructor for a plan. No unreviewed suggestion is shown.
#
# Switched-off features disappear: help requests (no questions or answers),
# office hours (no next session), learning plans (no catch-up plan), private
# meetings. A read-only enrollment (paused or ended) has no next step, pace or
# next session; its past lessons and feedback stay readable (§12, decision 7).
#
# Queries are fixed: LearnerProgress's set, then graders, the reviewer, help
# requests with their replies and notifications, unread instructor messages
# and the plan's latest revision, none per lesson or submission.
class StudentToday
  LIST_LIMIT = 5
  RECENTLY_GRADED_LIMIT = 3
  HELP_ANSWER_WINDOW = 14.days

  def initialize(enrollment, progress:, features:, now: Time.current)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @student = enrollment.user
    @progress = progress
    @features = features
    @now = now
    @read_only = !enrollment.active?
    @work = MyWork.new(enrollment, progress: progress)
  end

  def call
    redos = @work.items(@progress.redo_submissions, "redo")
    waiting = @work.items(@progress.awaiting_review_submissions, "waiting")
    graded = @work.items(@progress.graded_submissions.first(RECENTLY_GRADED_LIMIT), "graded")
    requests = help_requests
    answers = help_answers(requests)
    needs_you = redos.map { |item| item.merge(kind: "redo") } + answers + unread_messages
    {
      mode: mode,
      first_run: !library? && !@read_only && @enrollment.start_here_dismissed_at.nil? && @progress.overall[:completed_lessons].zero? && @progress.latest_submissions.empty?,
      continue_watching: library? ? continue_watching : nil,
      read_only: @read_only,
      paused: @enrollment.paused?,
      course_week: course_week,
      counts: library? ? nil : @progress.overall.slice(:completed_lessons, :total_lessons),
      next_lesson: next_lesson_json,
      this_week: program_active? ? @progress.pace[:this_week] : nil,
      pace: pace_json,
      catch_up_plan: catch_up_plan_json,
      needs_you: { count: needs_you.size, items: needs_you },
      waiting: { count: waiting.size, items: waiting.first(LIST_LIMIT) },
      recently_graded: graded,
      reviews_count: @progress.graded_submissions.size + redos.size,
      questions: questions_json(requests),
      next_session: next_session,
      reviewer: @work.person_json(@work.reviewer),
      # Someone the learner can message now (StaffContact); nil hides every message action.
      contact: @work.person_json(@work.contact),
      # "Ask for a catch-up plan" only where plans exist and someone can be asked.
      can_ask_for_plan: program_active? && @features["learning_plans"] == true && @work.contact.present?,
      review_response_time: @cohort.effective_review_response_time,
      support: support_json,
      recently_added: library? ? recently_added : []
    }
  end

  private

  def mode
    return "library" if library?

    @cohort.self_paced? ? "self_paced" : "program"
  end

  def library? = @cohort.alumni?

  def program_active? = mode == "program" && !@read_only

  # "Week 11 of 16" for a dated program, the same rule as Learn's outline.
  def course_week
    today = @progress.today
    return nil unless mode == "program" && @cohort.start_date && @cohort.end_date && today >= @cohort.start_date

    total = ((@cohort.end_date - @cohort.start_date).to_i / 7) + 1
    { current: [ ((today - @cohort.start_date).to_i / 7) + 1, total ].min, total: total }
  end

  # The one next step. Read-only learners get the lesson they'd read next
  # (`read_only` tells the client it's not work to hand in); the library has none.
  def next_lesson_json
    return nil if library?

    lesson = @progress.next_lesson
    return nil unless lesson

    mod = @progress.content.modules.find { |item| item.id == lesson.module_id }
    siblings = @progress.content.lessons_for(mod)
    {
      id: lesson.id,
      title: lesson.title,
      kind: LessonKind.for(lesson),
      module_id: mod.id,
      module_name: mod.name,
      week: mode == "program" ? (mod.day_offset.to_i + lesson.release_day) / 7 + 1 : nil,
      number: @progress.lessons.index(lesson) + 1,
      position: siblings.index(lesson).to_i + 1,
      module_lesson_count: siblings.size,
      status: @progress.lesson_progress(lesson).status
    }
  end

  def pace_json
    return nil unless program_active?

    pace = @progress.pace
    { behind: pace[:behind], weeks_behind: pace[:weeks_behind], overdue_count: pace[:overdue_lessons].size }
  end

  # The agreed plan: the saved, active learning plan the learner already sees,
  # its target date, who saved it last and when, and the required lessons in
  # its milestones that aren't handed in yet, in milestone order.
  def catch_up_plan_json
    plan = @progress.plan
    return nil unless plan && !library?

    milestone_dates = plan.milestones.flat_map { |item| item["lesson_ids"].map { |id| [ id, item["due_on"] ] } }.to_h
    lessons = @progress.lessons.index_by(&:id)
    remaining = milestone_dates.keys.filter_map { |id| lessons[id] }
      .select { |lesson| @progress.required?(lesson) && !@progress.lesson_progress(lesson).completed }
    revision = plan.revisions.order(created_at: :desc, id: :desc).includes(:author).first
    {
      title: plan.title,
      target_date: plan.target_date,
      agreed_at: (revision&.created_at || plan.updated_at).iso8601(6),
      agreed_by: revision&.author && { id: revision.author.id, full_name: revision.author.full_name },
      remaining_count: remaining.size,
      items: remaining.map do |lesson|
        entry = @progress.lesson_progress(lesson)
        { lesson_id: lesson.id, title: lesson.title, kind: LessonKind.for(lesson), due_on: milestone_dates[lesson.id], available: entry.available, status: entry.status }
      end
    }
  end

  def help_on? = @features["help_requests"] == true

  # The learner's own requests in this cohort that are active, or resolved
  # recently. Only their question and the replies sent to them.
  def help_requests
    return [] unless help_on?

    @help_requests ||= HelpRequest.where(student_id: @student.id, cohort_id: @cohort.id)
      .where("status IN (:active) OR (status = :resolved AND resolved_at >= :since)",
        active: HelpRequest.statuses.values_at("open", "acknowledged"), resolved: HelpRequest.statuses["resolved"], since: @now - HELP_ANSWER_WINDOW)
      .includes(replies: :author).order(created_at: :desc, id: :desc).to_a
  end

  # An answer the learner hasn't opened yet: a request with a staff reply whose
  # notification to the learner is still unread.
  def help_answers(requests)
    answered = requests.select { |request| request.replies.any? || request.staff_response.present? }
    return [] if answered.empty?

    unread = Notification.unread.where(user_id: @student.id, notifiable_type: "HelpRequest", notifiable_id: answered.map(&:id)).index_by(&:notifiable_id)
    blocks = LearningDestination.help_request_blocks(answered)
    answered.filter_map do |request|
      notification = unread[request.id]
      next unless notification

      reply = request.replies.max_by { |item| [ item.created_at, item.id ] }
      {
        kind: "help_answer",
        help_request_id: request.id,
        notification_id: notification.id,
        context_label: request.context_label,
        path: help_path(request, blocks),
        replied_by: reply && { id: reply.author.id, full_name: reply.author.full_name },
        replied_at: reply&.created_at || request.resolved_at || request.acknowledged_at,
        excerpt: MarkdownExcerpt.call(reply&.body || request.staff_response),
        resolved: request.status_resolved?
      }
    end
  end

  # Requests still waiting for a first reply (L-1.3): "Your question is waiting".
  # Every one is sent, so the count is what Today can show (five, then Show all).
  def questions_json(requests)
    waiting = requests.select { |request| (request.status_open? || request.status_acknowledged?) && request.replies.empty? && request.staff_response.blank? }
    blocks = LearningDestination.help_request_blocks(waiting)
    {
      count: waiting.size,
      items: waiting.map do |request|
        {
          id: request.id,
          status: request.status,
          context_label: request.context_label,
          message: MarkdownExcerpt.call(request.message),
          created_at: request.created_at,
          path: help_path(request, blocks)
        }
      end
    }
  end

  # The lesson with the request's dialog open (L-1.3).
  def help_path(request, blocks)
    LearningDestination.help_request(request, blocks: blocks, open: true)
  end

  # The newest unread message from staff in each of the learner's
  # conversations for this cohort, newest first. One row per conversation
  # (picked in SQL before ordering), so a busy conversation can't hide the
  # others; every conversation with something unread is listed. Blocked
  # people's messages are left out.
  def unread_messages
    member_join = ApplicationRecord.sanitize_sql_array([
      "INNER JOIN direct_conversation_members current_members ON current_members.direct_conversation_id = messages.direct_conversation_id AND current_members.user_id = ?",
      @student.id
    ])
    conversations = DirectConversation.visible_for(@student).where(cohort_id: @cohort.id).select(:id)
    # Thread replies count too, as in the conversation's unread badge.
    scope = Message.visible.where(direct_conversation_id: conversations)
      .where.not(author_id: [ @student.id, *@student.blocked_relationship_user_ids ])
      .where(author_id: User.where(role: %i[instructor admin]).select(:id))
      .joins(member_join)
    MessageReadCursor.after_joined(scope, "current_members")
      .select("DISTINCT ON (messages.direct_conversation_id) messages.*")
      .order(Arel.sql("messages.direct_conversation_id, messages.created_at DESC, messages.id DESC"))
      .includes(:author, :message_attachments).to_a
      .sort_by { |message| [ message.created_at, message.id ] }.reverse.map do |message|
        {
          kind: "message",
          message_id: message.id,
          direct_conversation_id: message.direct_conversation_id,
          author: { id: message.author.id, full_name: message.author.full_name },
          excerpt: MarkdownExcerpt.call(MessageJson.preview(message)),
          sent_at: message.created_at
        }
      end
  end

  # The next live class or office hours with its Join link, looking past this
  # week (L-1.4). Read-only learners and a switched-off feature get none.
  def next_session
    return nil if @read_only || @features["office_hours"] != true

    OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(@cohort), limit: 1).first
  end

  # One support message for the course (U-5.5), from the same rules lessons use.
  def support_json
    capabilities = EnrollmentCapabilities.for(@enrollment, features: @features)
    {
      mode: capabilities[:support_mode],
      live_support: capabilities[:live_support],
      ends_on: capabilities[:support_expires_at]&.in_time_zone(LearningCalendar::TIMEZONE)&.to_date,
      ended: @cohort.self_paced? && capabilities[:support_expires_at].present? && capabilities[:support_expires_at] <= @now
    }
  end

  def continue_watching
    return nil unless @features["recordings"] == true

    recordings = @cohort.recordings.student_visible.select { |item| @enrollment.recording_available_for_read?(item) }

    watched = @student.watch_progresses.where(recording_id: recordings.map(&:id), completed: false).where("last_position_seconds > 0").order(last_watched_at: :desc, id: :desc).first
    recording = recordings.find { |item| item.id == watched&.recording_id }
    return nil unless recording

    { title: recording.title, path: LearningDestination.recording(recording_id: recording.id, cohort_id: @cohort.id) }
  end

  def recently_added
    @progress.lessons.select { |lesson| @progress.available?(lesson) }
      .sort_by { |lesson| [ lesson.created_at, lesson.id ] }.reverse.first(LIST_LIMIT)
      .map { |lesson| { id: lesson.id, title: lesson.title, kind: LessonKind.for(lesson) } }
  end
end
