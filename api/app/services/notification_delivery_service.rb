class NotificationDeliveryService
  def self.announcement_published(announcement, push: false)
    new.announcement_published(announcement, push: push)
  end

  def self.message_created(message, push: false)
    new.message_created(message, push: push)
  end

  def self.submission_created(submission, push: true)
    new.submission_created(submission, push: push)
  end

  def self.submission_graded(submission, push: true)
    new.submission_graded(submission, push: push)
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
      PushNotificationJob.perform_later("Message", message.id, notification_ids)
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

  def submission_created(submission, push: true)
    # Staff authorization is intentionally platform-wide today: instructors and
    # admins can view every active cohort, and there is no teaching-team
    # assignment model to scope this further without silently dropping alerts.
    notifications = User.not_archived.where(role: %i[instructor admin]).find_each.filter_map do |staff|
      submission_notification_for(
        staff,
        submission,
        actor: submission.user,
        title: "New submission ready for review",
        body: submission.content_block.lesson.title,
        path: "/admin/grading"
      )
    end
    enqueue_submission_push(submission, notifications) if push
    notifications
  end

  def submission_graded(submission, push: true)
    title = submission.grade == "R" ? "Redo requested" : "Submission graded #{submission.grade}"
    body = submission.feedback.presence || submission.content_block.lesson.title
    notification = submission_notification_for(
      submission.user,
      submission,
      actor: submission.grader,
      title: title,
      body: body,
      path: "/lessons/#{submission.content_block.lesson_id}"
    )
    enqueue_submission_push(submission, [ notification ]) if push
    [ notification ]
  end

  private

  def submission_notification_for(user, submission, actor:, title:, body:, path:)
    notification = Notification.find_or_initialize_by(notifiable: submission, user: user)
    attributes = {
      actor: actor,
      notification_type: :submission,
      title: title,
      body: body,
      path: path,
      read_at: nil
    }
    notification.assign_attributes(attributes)
    notification.save!
    notification
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: submission, user: user).tap do |existing|
      existing.update!(attributes)
    end
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
