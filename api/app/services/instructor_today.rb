# Today is an action inbox, not another learner status definition. Quiet
# qualification comes exclusively from AttentionProjection (#272).
class InstructorToday
  def initialize(user:, cohorts:, attention:, now: Time.current, scoped: false)
    @user, @cohorts, @attention, @now = user, cohorts, attention, now
    @scoped = scoped
    @blocked_ids = user.blocked_relationship_user_ids
    @review_targets = cohorts.index_by(&:id).transform_values(&:review_sla_business_days)
    school = FeatureSwitches.school
    @features = cohorts.to_h { |cohort| [ cohort.id, FeatureSwitches.for(cohort: cohort, school: school) ] }
  end

  def call
    rows = @attention[:enrollments]
    paused = Enrollment.where(cohort_id: @cohorts.map(&:id), status: :paused).preload(module_assignments: :curriculum_module)
    rows += AttentionProjection.new(enrollment_scope: paused, now: @now).call[:enrollments]
    identities = rows.index_by { |row| [ row[:user_id], row[:cohort_id] ] }
    items = []
    HelpRequest.active_queue.where(cohort_id: feature_ids("help_requests")).order(:created_at, :id).each do |request|
      row = identities[[ request.student_id, request.cohort_id ]]
      next unless row
      items << item(row, "help", request.id, request.created_at, request.message, "Reply", "/admin/help-requests/#{request.id}", "/staff/support/#{request.id}").merge(urgent: request.urgency_urgent?)
    end
    latest = Submission.where(enrollment_id: rows.map { |row| row[:enrollment_id] }).latest_attempts
    by_enrollment = rows.index_by { |row| row[:enrollment_id] }
    latest.where(grade: nil).includes(content_block: :lesson).order(:created_at, :id).each do |submission|
      row = by_enrollment.fetch(submission.enrollment_id)
      items << item(row, "review", submission.id, submission.created_at, submission.content_block.title.presence || submission.content_block.lesson.title, "Open grading", grading_path(row[:cohort_id], submission.id), "/staff/submission/#{submission.id}")
        .merge(overdue_review(submission, row[:cohort_id]))
    end
    items.concat(unread_items(identities))
    rows.each do |row|
      row[:reasons].select { |reason| %w[follow_up_due recovery_due].include?(reason[:code]) }.each do |reason|
        feature = reason[:code] == "follow_up_due" ? "interventions" : "learning_plans"
        next unless feature_ids(feature).include?(row[:cohort_id])
        action = reason[:action]
        items << item(row, "follow_up", "#{reason[:code]}-#{reason[:source_ids].first}", reason[:since], reason[:label], action[:label], action[:web_path], action[:native_path])
      end
    end
    rows.select { |row| row[:status] == "active" && row[:inactive] }.each do |row|
      items << item(row, "quiet", row[:enrollment_id], row[:last_activity_at] || row[:joined_at], "No learning activity in 7+ days", "Message", nil, nil)
    end
    # Stable category priority, urgent help and overdue reviews first in their own categories.
    # Help is always first, followed by review, unread conversations, follow-ups, and quiet.
    items.sort_by! { |entry| [ %w[help review message follow_up quiet].index(entry[:kind]), (entry[:urgent] || entry[:overdue]) ? 0 : 1, entry[:since] || @now, entry[:id] ] }
    counts = items.map { |entry| entry[:kind] }.tally
    visible = items.group_by { |entry| entry[:kind] }.values.flat_map { |entries| entries.first(20) }
    represented = visible.map { |entry| [ entry[:user_id], entry[:cohort_id] ] }
    represented_count = @attention[:students].count { |row| represented.include?([ row[:user_id], row[:cohort_id] ]) }
    remaining = @attention[:summary][:student_count] - represented_count
    { items: visible, counts: counts, attention_remaining: remaining, upcoming: upcoming }
  end

  private

  def overdue_review(submission, cohort_id)
    business_days = @review_targets[cohort_id]
    return {} unless business_days

    @review_sla ||= ReviewSla.new(holidays: SchoolSetting.current.review_sla_holidays)
    target = @review_sla.call(submitted_at: submission.created_at, business_days: business_days, now: @now)
    target[:overdue] ? { overdue: true, expected_review_by: target[:expected_by] } : {}
  end

  # The Grading workbench, scoped to the cohort with this attempt open: Save and next keeps going.
  def grading_path(cohort_id, submission_id)
    "/admin/grading?#{{ cohort_id: cohort_id, submission: submission_id }.compact.to_query}"
  end

  def feature_ids(key)
    @features.select { |_, features| features[key] }.keys
  end

  def item(row, kind, id, since, text, label, web, native)
    { id: id, kind: kind, urgent: false, since: since, text: text, user_id: row[:user_id], full_name: row[:full_name],
      student_record: row.fetch(:student_record, true), cohort_id: row[:cohort_id], cohort_name: row[:cohort_name], action_label: label, web_path: web, native_path: native }
  end

  def unread_items(identities)
    conversations = DirectConversation.visible_for(@user)
    conversations = conversations.where(cohort_id: @cohorts.map(&:id)) if @scoped
    conversations = conversations.select(:id)
    join = ApplicationRecord.sanitize_sql_array([ "JOIN direct_conversation_members current_members ON current_members.direct_conversation_id = messages.direct_conversation_id AND current_members.user_id = ?", @user.id ])
    unread = MessageReadCursor.after_joined(Message.visible.where(direct_conversation_id: conversations).where.not(author_id: @user.id).joins(join), "current_members")
    # One row per conversation, showing its oldest unread message, including text.
    unread.select("DISTINCT ON (messages.direct_conversation_id) messages.*").order(:direct_conversation_id, :created_at, :id)
      .includes(:author, :message_attachments, direct_conversation: :cohort).filter_map do |message|
      conversation = message.direct_conversation
      row = identities[[ message.author_id, conversation.cohort_id ]]
      row ||= { student_record: message.author.student?, user_id: message.author_id, full_name: message.author.full_name,
        cohort_id: conversation.cohort_id, cohort_name: conversation.cohort&.name }
      item(row, "message", conversation.id, message.created_at, MessageJson.preview(message, blocked: @blocked_ids.include?(message.author_id)), "Open message", "/messages/dm/#{conversation.id}", "/conversation/dm/#{conversation.id}")
    end
  end

  def upcoming
    day = @now.in_time_zone(LearningCalendar::TIMEZONE).to_date
    events = OfficeHour.active.where(cohort_id: feature_ids("office_hours")).includes(:cohort).flat_map do |event|
      event.upcoming_occurrences(limit: 1, from: @now).filter_map do |occurrence|
        next unless occurrence[:starts_at].in_time_zone(LearningCalendar::TIMEZONE).to_date == day
        { title: "#{event.title} · #{event.cohort.name}", starts_at: occurrence[:starts_at], web_path: "/admin/cohorts/#{event.cohort_id}?tab=schedule" }
      end
    end
    bookings = PrivateMeetingBooking.confirmed.where(cohort_id: feature_ids("private_meetings"))
    bookings = bookings.where(instructor_id: @user.id) unless @user.admin?
    bookings.where(starts_at: day.in_time_zone(LearningCalendar::TIMEZONE).all_day).where("ends_at >= ?", @now).includes(:student, :cohort).each do |booking|
      events << { title: "Meeting · #{booking.student.full_name} · #{booking.cohort.name}", starts_at: booking.starts_at, web_path: "/admin/meetings?cohort_id=#{booking.cohort_id}" }
    end
    events.sort_by { |event| [ event[:starts_at], event[:web_path] ] }
  end
end
