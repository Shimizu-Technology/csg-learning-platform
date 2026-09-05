class NotificationDeliveryService
  def self.announcement_published(announcement, push: false)
    new.announcement_published(announcement, push: push)
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

  def self.help_request_changed(help_request, push: true)
    new.help_request_changed(help_request, push: push)
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

  def announcement_published(announcement, push: false)
    return [] unless announcement.published?

    notifications = announcement.recipients.find_each.filter_map do |user|
      notification_for(user, announcement)
    end

    PushNotificationJob.perform_later("Announcement", announcement.id, notifications.map(&:id)) if push && notifications.any?
    notifications
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
    if push && notifications.any?
      enqueue_message_push(message, notification_ids)
    end
    if message.direct_message? && notifications.any?
      MessageNotificationEmailJob.perform_later(message.id, notification_ids)
      # The generic DM job owns preference checks and delivery for every DM
      # recipient, so mentioned participants must never enter the mention path.
      mention_email_skip_user_ids = mentioned_user_ids
    end
    MessageMentionEmailJob.perform_later(message.id, mentioned_user_ids, mention_email_skip_user_ids) if mentioned_user_ids.any?
    notifications
  end

  def submission_created(submission, push: true, event_at: submission.created_at)
    # Staff authorization is intentionally platform-wide today: instructors and
    # admins can view every active cohort, and there is no teaching-team
    # assignment model to scope this further without silently dropping alerts.
    notifications = User.not_archived.where(role: %i[instructor admin]).find_each.filter_map do |staff|
      notification, claimed = submission_notification_for(
        staff,
        submission,
        actor: submission.user,
        title: "New submission ready for review",
        body: submission.content_block.lesson.title,
        path: "/admin/grading",
        event_at: event_at
      )
      notification if claimed
    end
    enqueue_submission_push(submission, notifications) if push
    notifications
  end

  def submission_graded(submission, push: true, event_at: submission.graded_at || Time.current)
    title = submission.grade == "R" ? "Redo requested" : "Submission graded #{submission.grade}"
    body = submission.feedback.presence || submission.content_block.lesson.title
    notification, claimed = submission_notification_for(
      submission.user,
      submission,
      actor: submission.grader,
      title: title,
      body: body,
      path: "/lessons/#{submission.content_block.lesson_id}",
      event_at: event_at
    )
    enqueue_submission_push(submission, [ notification ]) if push && claimed
    [ notification ]
  end

  def help_request_created(help_request, push: true)
    notifications = User.not_archived.where(role: %i[instructor admin]).find_each.map do |staff|
      help_request_notification_for(
        staff,
        help_request,
        actor: help_request.student,
        title: help_request.urgency_urgent? ? "Urgent student help request" : "Student asked for help",
        body: "#{help_request.student.full_name} · #{help_request.context_label}",
        path: "/admin/support"
      )
    end
    PushNotificationJob.perform_later("HelpRequest", help_request.id, notifications.map(&:id)) if push && notifications.any?
    notifications
  end

  def help_request_changed(help_request, push: true)
    close_staff_help_notifications(help_request) if help_request.status_resolved?
    title = help_request.status_resolved? ? "Help request resolved" : "Instructor acknowledged your request"
    body = help_request.status_resolved? ? "Review the response for #{help_request.context_label}" : "#{help_request.owner&.full_name || 'Your instructor'} is taking a look"
    notification = help_request_notification_for(
      help_request.student,
      help_request,
      actor: help_request.owner,
      title: title,
      body: body,
      path: help_request.context_path
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
    notification = intervention_notification_for(
      intervention,
      title: "Student intervention assigned",
      body: "#{intervention.enrollment.user.full_name} · #{intervention.trigger_type.humanize}",
      actor: intervention.created_by
    )
    PushNotificationJob.perform_later("Intervention", intervention.id, [ notification.id ]) if push
    [ notification ]
  end

  def intervention_follow_up_due(intervention, push: true)
    notification = intervention_notification_for(
      intervention,
      title: "Student follow-up due",
      body: "#{intervention.enrollment.user.full_name} · #{intervention.trigger_type.humanize}",
      actor: nil
    )
    PushNotificationJob.perform_later("Intervention", intervention.id, [ notification.id ]) if push
    [ notification ]
  end

  private

  def enqueue_message_push(message, notification_ids)
    claimed_ids = message.with_lock do
      enqueued_ids = Array(message.push_enqueued_notification_ids).map(&:to_i)
      next_ids = notification_ids - enqueued_ids
      message.update_columns(push_enqueued_notification_ids: (enqueued_ids + next_ids).uniq) if next_ids.any?
      next_ids
    end
    return if claimed_ids.empty?

    PushNotificationJob.perform_later("Message", message.id, claimed_ids)
  rescue StandardError
    safely_release_message_push_claim(message, Array(claimed_ids))
    raise
  end

  def safely_release_message_push_claim(message, claimed_ids)
    return if claimed_ids.empty?

    message.with_lock do
      enqueued_ids = Array(message.push_enqueued_notification_ids).map(&:to_i)
      message.update_columns(push_enqueued_notification_ids: enqueued_ids - claimed_ids)
    end
  rescue StandardError => error
    Rails.logger.warn("NotificationDeliveryService: push claim cleanup failed: #{error.class}: #{error.message}")
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

  def notification_for(user, announcement)
    Notification.find_or_create_by!(notifiable: announcement, user: user) do |notification|
      notification.actor = announcement.author
      notification.notification_type = :announcement
      notification.title = announcement.title
      notification.body = announcement.body
      notification.path = "/announcements/#{announcement.id}"
    end
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: announcement, user: user)
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
    return "#{message.author.full_name} sent you a message" if message.direct_message?
    return "#{message.author.full_name} mentioned you in ##{message.channel.name}" if mentioned
    return "##{message.channel.name} has an @everyone message" if channel_mention

    "#{message.channel.name} has a new message"
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
    return false unless message.channel_id.present?

    message.body.to_s.match?(/(^|[\s(])@everyone\b/i)
  end

  def mentioned_user_ids_for(message, recipients)
    raw_explicit_ids = Array(message.mention_user_ids)
    explicit_ids = raw_explicit_ids.map(&:to_i).uniq
    allowed_ids = recipients.each_with_object({}) { |user, ids| ids[user.id] = true }
    explicit_ids.select! { |id| allowed_ids.key?(id) && id != message.author_id }
    return explicit_ids if raw_explicit_ids.any?
    return [] if message.body.blank?

    body = message.body.to_s
    recipients.filter_map do |user|
      next if user.id == message.author_id
      next if user.full_name.blank?

      user.id if body.match?(mention_pattern_for(user.full_name))
    end
  end

  def mention_pattern_for(full_name)
    /(^|[^[:alnum:]_])@#{Regexp.escape(full_name)}(?=$|[[:space:][:punct:]])/i
  end
end
