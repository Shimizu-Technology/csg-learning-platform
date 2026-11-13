# A bounded, explicit allowlist for Leon's unattended morning brief.
class HomeBaseDigest
  LIMIT = 20

  def initialize(user, now: Time.current)
    @user = user
    @now = now
    @cohort_ids = user.accessible_cohorts.select(:id)
    @blocked_user_ids = user.blocked_relationship_user_ids
  end

  def call
    {
      generated_at: @now.iso8601,
      unread_direct_messages: direct_messages,
      unread_mentions: mentions,
      help_requests: help_requests,
      grading: grading,
      upcoming_private_meetings: meetings,
      due_interventions: due_cases(Intervention.due(@now), :next_follow_up_at),
      due_recovery_plans: due_cases(RecoveryPlan.due(@now), :next_check_in_at)
    }
  end

  private

  def direct_messages
    conversations = DirectConversation.visible_for(@user)
    unread = joined_unread(Message.visible.where(direct_conversation_id: conversations.select(:id)), :direct)
    ids = unread.group(:direct_conversation_id)
      .order(Arel.sql("MAX(messages.created_at) DESC, MAX(messages.id) DESC")).limit(LIMIT).pluck(:direct_conversation_id)
    counts = unread.where(direct_conversation_id: ids).group(:direct_conversation_id).count
    index = conversations.where(id: ids).includes(:users).index_by(&:id)
    ids.filter_map do |id|
      conversation = index[id]
      next unless conversation && counts[id].to_i.positive?
      latest = unread.where(direct_conversation_id: id).includes(:author).order(created_at: :desc, id: :desc).first
      # Reading/archiving/deleting in the app may change the queue between queries.
      next unless latest

      {
        conversation_id: id, conversation: safe_text(conversation.title_for(@user)),
        unread_count: counts.fetch(id), latest_message_at: latest.created_at.iso8601,
        **message_fields(latest), age_seconds: age(latest.created_at)
      }
    end
  end

  def mentions
    unread = joined_unread(Message.visible.where(channel_id: Channel.visible_for(@user).select(:id)), :channel)
      .where.not(author_id: @blocked_user_ids).includes(:author, :channel)
    rows = []
    # Bound memory even when a channel has a long unread history without mentions.
    unread.find_each(cursor: [ :created_at, :id ], order: [ :desc, :desc ], batch_size: 100) do |message|
      next unless MessageMentions.user_ids_for(message, [ @user ]).include?(@user.id) || MessageMentions.channel_mention?(message)

      rows << { message_id: message.id, channel_id: message.channel_id, channel: safe_text(message.channel.name),
                created_at: message.created_at.iso8601, age_seconds: age(message.created_at), **message_fields(message) }
      break if rows.size >= LIMIT
    end
    rows
  end

  def joined_unread(scope, kind)
    if kind == :direct
      table, foreign_key, alias_name = "direct_conversation_members", "direct_conversation_id", "current_members"
    else
      table, foreign_key, alias_name = "channel_read_states", "channel_id", "message_read_states"
    end
    join = ApplicationRecord.sanitize_sql_array([
      "LEFT JOIN #{table} #{alias_name} ON #{alias_name}.#{foreign_key} = messages.#{foreign_key} AND #{alias_name}.user_id = ?", @user.id
    ])
    MessageReadCursor.after_joined(scope.where.not(author_id: @user.id).joins(join), alias_name)
  end

  def message_fields(message)
    blocked = @blocked_user_ids.include?(message.author_id)
    { sender_name: safe_text(message.author.full_name), snippet: blocked ? "Message hidden" : safe_text(message.body) }
  end

  def help_requests
    HelpRequest.active_queue.where(cohort_id: @cohort_ids).includes(:student).queue_order.order(:id).limit(LIMIT).map do |request|
      { id: request.id, student_name: safe_text(request.student.full_name), cohort_id: request.cohort_id,
        status: request.status, urgency: request.urgency, owner_id: request.owner_id,
        created_at: request.created_at.iso8601, age_seconds: age(request.created_at) }
    end
  end

  def grading
    scope = Submission.where(enrollment_id: Enrollment.where(cohort_id: @cohort_ids).select(:id))
    # Select latest across ALL attempts before excluding graded work.
    latest = scope.select("DISTINCT ON (enrollment_id, user_id, content_block_id) submissions.id")
      .order(:enrollment_id, :user_id, :content_block_id, created_at: :desc, id: :desc)
    cohort_names = Cohort.where(id: @cohort_ids).pluck(:id, :name).to_h
    module_names = CurriculumModule.pluck(:id, :name).to_h
    Submission.where(id: latest, grade: nil).joins(:enrollment, content_block: :lesson)
      .group("enrollments.cohort_id", "lessons.module_id")
      .order(Arel.sql("MIN(submissions.created_at), enrollments.cohort_id, lessons.module_id")).limit(LIMIT)
      .pluck("enrollments.cohort_id", "lessons.module_id", Arel.sql("COUNT(*)"), Arel.sql("MIN(submissions.created_at)")).map do |cohort_id, module_id, count, oldest|
        { cohort_id: cohort_id, cohort: safe_text(cohort_names[cohort_id]), module_id: module_id, module: safe_text(module_names[module_id]), count: count, oldest_waiting_at: oldest.iso8601,
          oldest_waiting_age_seconds: age(oldest) }
      end
  end

  def meetings
    PrivateMeetingBooking.confirmed.where(instructor_id: @user.id, cohort_id: @cohort_ids, starts_at: @now..(@now + 2.days))
      .includes(:student).order(:starts_at, :id).limit(LIMIT).map do |meeting|
        { id: meeting.id, student_name: safe_text(meeting.student.full_name), cohort_id: meeting.cohort_id,
          starts_at: meeting.starts_at.iso8601, ends_at: meeting.ends_at.iso8601 }
      end
  end

  def due_cases(scope, date_field)
    scope.where(owner_id: @user.id).joins(:enrollment).where(enrollments: { cohort_id: @cohort_ids })
      .includes(enrollment: :user).order(date_field, :id).limit(LIMIT).map do |record|
        due = record.public_send(date_field)
        { id: record.id, student_name: safe_text(record.enrollment.user.full_name), cohort_id: record.enrollment.cohort_id,
          due_at: due.iso8601, overdue_seconds: age(due) }
      end
  end

  def age(timestamp)
    [ (@now - timestamp).to_i, 0 ].max
  end

  # No contact details from message previews or user-controlled labels.
  def safe_text(value)
    normalized = MarkdownExcerpt.call(value.to_s, max_length: Float::INFINITY)
    redacted = normalized.gsub(/[^\s@]+@[^\s@]+\.[^\s@]+/, "[email redacted]")
      .gsub(/(?<!\w)\+?\d[\d ().-]{5,}\d(?!\w)/, "[phone redacted]")
    redacted.truncate(200, omission: "…")
  end
end
