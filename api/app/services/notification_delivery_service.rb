class NotificationDeliveryService
  def self.system_notice(record, notifications)
    PushNotificationJob.perform_later(record.class.name, record.id, notifications.map(&:id)) if notifications.any?
  end

  def self.announcement_published(announcement, push: false, async: true)
    new.announcement_published(announcement, push: push, async: async)
  end

  def self.message_created(message, push: false)
    new.message_created(message, push: push)
  end

  def self.submission_created(submission, push: true, event_at: submission.created_at)
    new.submission_created(submission, push: push, event_at: event_at)
  end

  def self.submission_graded(submission, push: true, event_at: submission.graded_at || Time.current)
    new.submission_graded(submission, push: push, event_at: event_at)
  end

  def self.help_request_created(help_request, push: true)
    new.help_request_created(help_request, push: push)
  end

  # Acknowledged, replied to (`reply:` kept the request open) or resolved.
  # One in-app notification per learner per request, updated in place, and
  # one push per call.
  def self.help_request_changed(help_request, push: true, reply: nil)
    new.help_request_changed(help_request, push: push, reply: reply)
  end

  # Staff open the exact request with its cohort and student (L-3.7), as submissions do.
  def self.staff_help_request_path(help_request)
    RecordDestination.to_web_path(RecordDestination.build(kind: "help_request", id: help_request.id, context: { cohort_id: help_request.cohort_id, student_id: help_request.student_id }))
  end

  # Admin alerts (L-3.5). Runs from AdminAlertJob, after the record's transaction commits.
  def self.admin_alert(record, push: true)
    new.admin_alert(record, push: push)
  end

  def self.help_request_canceled(help_request)
    new.help_request_canceled(help_request)
  end

  def self.intervention_assigned(intervention, push: true)
    new.intervention_assigned(intervention, push: push)
  end

  def self.intervention_follow_up_due(intervention, push: true)
    new.intervention_follow_up_due(intervention, push: push)
  end

  ANNOUNCEMENT_BATCH_SIZE = 100
  ANNOUNCEMENT_INLINE_LIMIT = 50

  # Persist the intent in the caller's publish transaction. Only a bounded
  # small audience is written here; larger audiences run on the async adapter
  # even when ordinary jobs use inline. The tick recovers a lost async enqueue.
  def announcement_published(announcement, push: false, async: true)
    return [] unless announcement.published?

    ids = announcement.recipients.reorder(:id).pluck(:id)
    announcement.update_columns(fanout_requested_at: announcement.fanout_requested_at || Time.current, fanout_recipient_ids: ids)
    if ids.size > ANNOUNCEMENT_INLINE_LIMIT
      if async
        AnnouncementFanoutJob.perform_later(announcement.id)
      else
        ActiveRecord.after_all_transactions_commit { AnnouncementFanoutJob.perform_now(announcement.id) }
      end
      return []
    end

    notification_ids = ids.empty? ? [] : insert_announcement_notifications(announcement, ids)
    announcement.update_columns(fanout_settled_at: Time.current)
    PushNotificationJob.perform_later("Announcement", announcement.id, notification_ids) if push
    notification_ids
  end

  # Called only under a short announcement lock by AnnouncementFanoutJob.
  # An INSERT and its cursor commit together; retrying either side of a crash
  # cannot skip a recipient or reset an existing notification's read state.
  def announcement_batch(announcement, ids)
    insert_announcement_notifications(announcement, ids) if ids.any?
  end

  def message_created(message, push: false)
    return [] if message.deleted?

    destination = message.destination
    recipients = destination.recipients.to_a
    mentioned_user_ids = mentioned_user_ids_for(message, recipients)
    channel_mention = channel_mention?(message)
    muted_user_ids = MessagePreference.where(target: destination, muted: true)
      .pluck(:user_id)
      .index_with(true)

    notifications = recipients.filter_map do |user|
      next if user.id == message.author_id
      next if UserBlock.between(message.author_id, user.id).exists?
      next if muted_user_ids.key?(user.id) && !mentioned_user_ids.include?(user.id) && !channel_mention

      message_notification_for(
        user,
        message,
        mentioned: mentioned_user_ids.include?(user.id),
        channel_mention: channel_mention
      )
    end

    notification_ids = notifications.map(&:id)
    mention_email_skip_user_ids = []
    push_not_started = nil
    if push && notifications.any?
      begin
        enqueue_message_push(message, notification_ids)
      rescue PushDeliveryNotStarted => error
        # Inline, the push ran here and its deadline left some notifications
        # unsent (their claims are released). Send the emails first, then let
        # the stage fail so the sender's replay pushes the rest.
        push_not_started = error
      end
    end
    if message.direct_message? && notifications.any?
      MessageNotificationEmailJob.perform_later(message.id, notification_ids)
      # The generic DM job owns preference checks and delivery for every DM
      # recipient, so mentioned participants must never enter the mention path.
      mention_email_skip_user_ids = mentioned_user_ids
    end
    MessageMentionEmailJob.perform_later(message.id, mentioned_user_ids, mention_email_skip_user_ids) if mentioned_user_ids.any?
    raise push_not_started if push_not_started

    notifications
  end

  def submission_created(submission, push: true, event_at: submission.created_at)
    path = staff_submission_path(submission)
    notifications = staff_for_cohort(submission.enrollment&.cohort).find_each.filter_map do |staff|
      notification, claimed = submission_notification_for(
        staff,
        submission,
        actor: submission.user,
        title: "#{submission.user.full_name} submitted #{submission.content_block.display_title(fallback: "an exercise")}",
        body: "#{submission.content_block.lesson.title} · Attempt #{submission.num_submissions}",
        path: path,
        event_at: event_at
      )
      notification if claimed
    end
    enqueue_submission_push(submission, notifications) if push
    notifications
  end

  def submission_graded(submission, push: true, event_at: submission.graded_at || Time.current)
    reviewer = submission.grader&.full_name || "#{SchoolBrand.current.abbreviation} staff"
    title = if submission.grade == "R"
      "#{reviewer} requested a redo on #{submission.content_block.display_title}"
    else
      "#{reviewer} graded #{submission.content_block.display_title}: #{submission.grade}"
    end
    body = submission.feedback.presence || submission.content_block.lesson.title
    notification, claimed = submission_notification_for(
      submission.user,
      submission,
      actor: submission.grader,
      title: title,
      body: body,
      path: LearningDestination.submission(submission),
      event_at: event_at
    )
    enqueue_submission_push(submission, [ notification ]) if push && claimed
    [ notification ]
  end

  def help_request_created(help_request, push: true)
    notifications = staff_for_cohort(help_request.cohort).find_each.map do |staff|
      help_request_notification_for(
        staff,
        help_request,
        actor: help_request.student,
        title: help_request.urgency_urgent? ? "#{help_request.student.full_name} needs urgent help" : "#{help_request.student.full_name} asked for help",
        body: [ help_request.cohort&.name, help_request.context_label ].compact_blank.join(" · "),
        path: self.class.staff_help_request_path(help_request)
      )
    end
    PushNotificationJob.perform_later("HelpRequest", help_request.id, notifications.map(&:id)) if push && notifications.any?
    notifications
  end

  def help_request_changed(help_request, push: true, reply: nil)
    close_staff_help_notifications(help_request) if help_request.status_resolved?
    staff_name = help_request.owner&.full_name.presence || "Your instructor"
    title, body = if help_request.status_resolved?
      [ "Help request resolved", "Review the response for #{help_request.context_label}" ]
    elsif reply
      [ "#{staff_name} replied to your help request", "Read the reply about #{help_request.context_label}" ]
    else
      [ "Instructor acknowledged your request", "#{staff_name} is taking a look" ]
    end
    notification = help_request_notification_for(
      help_request.student,
      help_request,
      actor: help_request.owner,
      title: title,
      body: body,
      path: LearningDestination.help_request(help_request)
    )
    PushNotificationJob.perform_later("HelpRequest", help_request.id, [ notification.id ]) if push
    [ notification ]
  end

  def help_request_canceled(help_request)
    close_staff_help_notifications(help_request)
    help_request.notifications.where(user: help_request.student)
      .update_all(read_at: Time.current, updated_at: Time.current)
  end

  def intervention_assigned(intervention, push: true)
    return [] unless intervention.owner_valid?

    notification = intervention_notification_for(
      intervention,
      title: "Follow up with #{intervention.enrollment.user.full_name}",
      body: intervention.trigger_type.humanize,
      actor: intervention.created_by
    )
    PushNotificationJob.perform_later("Intervention", intervention.id, [ notification.id ]) if push
    [ notification ]
  end

  def intervention_follow_up_due(intervention, push: true)
    return [] unless intervention.owner_valid?

    notification = intervention_notification_for(
      intervention,
      title: "Follow-up due for #{intervention.enrollment.user.full_name}",
      body: intervention.trigger_type.humanize,
      actor: nil
    )
    PushNotificationJob.perform_later("Intervention", intervention.id, [ notification.id ]) if push
    [ notification ]
  end

  # One notification per current admin (never the person who caused it). The
  # unique (notifiable, user) index makes a repeat call a no-op, and only rows
  # created by this call are pushed, so a replay never alerts anyone twice.
  def admin_alert(record, push: true)
    alert = admin_alert_content(record)
    return [] unless alert

    created = User.not_archived.admin.where.not(id: alert[:actor]&.id).find_each.filter_map do |admin|
      # Its own savepoint, so a duplicate never aborts a surrounding transaction.
      Notification.transaction(requires_new: true) do
        Notification.create!(notifiable: record, user: admin, actor: alert[:actor], **alert.except(:actor))
      end
    rescue ActiveRecord::RecordNotUnique
      nil
    end
    PushNotificationJob.perform_later(record.class.name, record.id, created.map(&:id)) if push && created.any?
    created
  end

  private

  def admin_alert_content(record)
    case record
    when ContentReport
      subject = record.message_id ? "a message from #{record.reported_user.full_name}" : record.reported_user.full_name
      {
        actor: record.reporter, notification_type: :content_report,
        title: "#{record.reporter.full_name} reported #{subject}",
        body: "Reason: #{record.reason.humanize}",
        path: RecordDestination.to_web_path(RecordDestination.build(kind: "content_report", id: record.id))
      }
    when DataDeletionRequest
      return unless record.status_pending?

      {
        actor: record.user, notification_type: :data_deletion_request,
        title: "#{record.user.full_name} asked to delete their account",
        body: "Review the request in Safety before anything is deleted.",
        path: RecordDestination.to_web_path(RecordDestination.build(kind: "deletion_request", id: record.id))
      }
    when CoursePurchase
      return unless record.status == "paid"

      price = record.price_cents && ActiveSupport::NumberHelper.number_to_currency(record.price_cents / 100.0)
      access = record.access_months && "#{record.access_months} #{"month".pluralize(record.access_months)} of access"
      {
        actor: record.user, notification_type: :course_purchase,
        title: "#{record.user.full_name} bought #{record.cohort.name}",
        body: [ price, access ].compact.join(" · ").presence,
        path: RecordDestination.to_web_path(RecordDestination.build(kind: "student", id: record.user_id, context: { cohort_id: record.cohort_id }))
      }
    end
  end

  def staff_for_cohort(cohort)
    return User.not_archived.admin unless cohort

    User.not_archived.where(role: User.roles[:admin])
      .or(User.not_archived.where(id: cohort.cohort_instructor_assignments.select(:user_id)))
  end

  def enqueue_message_push(message, notification_ids)
    return if notification_ids.empty?

    # Recovery may enqueue this job more than once after a crash. The job's
    # per-provider attempt checkpoint is the durable deduplication boundary.
    PushNotificationJob.perform_later("Message", message.id, notification_ids)
  end

  def intervention_notification_for(intervention, title:, body:, actor:)
    notification = Notification.find_or_initialize_by(notifiable: intervention, user: intervention.owner)
    notification.assign_attributes(
      actor: actor,
      notification_type: :intervention,
      title: title,
      body: body,
      path: "/admin/interventions/#{intervention.id}",
      read_at: nil
    )
    notification.save!
    notification
  rescue ActiveRecord::RecordNotUnique
    existing = Notification.find_by!(notifiable: intervention, user: intervention.owner)
    existing.update!(actor: actor, notification_type: :intervention, title: title, body: body, path: "/admin/interventions/#{intervention.id}", read_at: nil)
    existing
  end

  def close_staff_help_notifications(help_request)
    help_request.notifications.joins(:user).merge(User.where(role: %i[instructor admin]))
      .update_all(read_at: Time.current, updated_at: Time.current)
  end

  def help_request_notification_for(user, help_request, actor:, title:, body:, path:)
    notification = Notification.find_or_initialize_by(notifiable: help_request, user: user)
    notification.assign_attributes(
      actor: actor,
      notification_type: :help_request,
      title: title,
      body: body,
      path: path,
      read_at: nil
    )
    notification.save!
    notification
  rescue ActiveRecord::RecordNotUnique
    existing = Notification.find_by!(notifiable: help_request, user: user)
    existing.update!(actor: actor, notification_type: :help_request, title: title, body: body, path: path, read_at: nil)
    existing
  end

  def submission_notification_for(user, submission, actor:, title:, body:, path:, event_at:)
    notification = Notification.find_or_initialize_by(notifiable: submission, user: user)
    attributes = {
      actor: actor,
      notification_type: :submission,
      title: title,
      body: body,
      path: path,
      read_at: nil
    }
    return create_submission_notification(notification, attributes) if notification.new_record?

    update_submission_notification(notification, attributes, event_at)
  rescue ActiveRecord::RecordNotUnique
    existing = Notification.find_by!(notifiable: submission, user: user)
    update_submission_notification(existing, attributes, event_at)
  end

  def create_submission_notification(notification, attributes)
    notification.assign_attributes(attributes)
    notification.save!
    [ notification, true ]
  end

  def update_submission_notification(notification, attributes, event_at)
    claimed = false
    notification.with_lock do
      next if notification.updated_at >= event_at

      notification.update!(attributes)
      claimed = true
    end
    [ notification, claimed ]
  end

  def enqueue_submission_push(submission, notifications)
    return if notifications.empty?

    PushNotificationJob.perform_later("Submission", submission.id, notifications.map(&:id))
  end

  # One INSERT for a batch of recipients. insert_all skips model callbacks
  # and validations, so this sets what Notification#create would: the
  # timestamps and the email provenance marker (ProviderEmailProvenance's
  # before_create). Notification has no after-create callbacks or broadcasts.
  # Recipients already notified conflict on the unique index and are left
  # as they are; their ids are looked up only when that happens.
  def insert_announcement_notifications(announcement, user_ids)
    now = Time.current
    email_application = ProviderEmailProvenance.marker
    rows = user_ids.map do |user_id|
      {
        user_id: user_id,
        notifiable_type: "Announcement",
        notifiable_id: announcement.id,
        actor_id: announcement.author_id,
        notification_type: Notification.notification_types[:announcement],
        title: announcement.title,
        body: announcement.body,
        path: "/announcements/#{announcement.id}",
        email_application: email_application,
        created_at: now,
        updated_at: now
      }
    end
    inserted = Notification.insert_all(rows, unique_by: :index_notifications_unique_source_per_user, returning: %w[id user_id], record_timestamps: false)
    ids_by_user = inserted.rows.to_h { |id, user_id| [ user_id, id ] }
    missing = user_ids - ids_by_user.keys
    ids_by_user.merge!(Notification.where(notifiable: announcement, user_id: missing).pluck(:user_id, :id).to_h) if missing.any?
    user_ids.filter_map { |user_id| ids_by_user[user_id] }
  end

  def message_notification_for(user, message, mentioned: false, channel_mention: false)
    Notification.find_or_create_by!(notifiable: message, user: user) do |notification|
      notification.actor = message.author
      notification.notification_type = message.direct_message? ? :direct_message : :message
      notification.title = message_notification_title(message, mentioned: mentioned, channel_mention: channel_mention)
      notification.body = message_notification_body(message, mentioned: mentioned, channel_mention: channel_mention)
      notification.path = message.direct_message? ? "/messages/dm/#{message.direct_conversation_id}" : "/messages/#{message.channel_id}"
    end
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: message, user: user)
  end

  def message_notification_title(message, mentioned: false, channel_mention: false)
    return message.author.full_name if message.direct_message?
    return "#{message.author.full_name} mentioned you in ##{message.channel.name}" if mentioned
    return "#{message.author.full_name} used @everyone in ##{message.channel.name}" if channel_mention

    "#{message.author.full_name} in ##{message.channel.name}"
  end

  def staff_submission_path(submission)
    enrollment = submission.enrollment
    base_path = "/admin/submissions/#{submission.id}"
    return base_path unless enrollment

    "#{base_path}?cohort_id=#{enrollment.cohort_id}&student_id=#{submission.user_id}"
  end

  def message_notification_body(message, mentioned: false, channel_mention: false)
    body = message.body.to_s.strip
    return "Mentioned you: #{body}".truncate(180) if mentioned && body.present?
    return "@everyone: #{body}".truncate(180) if channel_mention && body.present?
    return body.truncate(180) if body.present?

    attachment_count = message.message_attachments.size
    return "Sent an attachment" if attachment_count == 1
    return "Sent #{attachment_count} attachments" if attachment_count > 1

    "Sent a message"
  end

  def channel_mention?(message)
    MessageMentions.channel_mention?(message)
  end

  def mentioned_user_ids_for(message, recipients)
    MessageMentions.user_ids_for(message, recipients)
  end
end
