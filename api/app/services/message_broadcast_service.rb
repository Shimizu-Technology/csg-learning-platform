require "set"

class MessageBroadcastService
  class BroadcastFailures < StandardError; end

  class << self
    def created(message, **options, &block)
      broadcast("created", message, **options, &block)
    end

    def updated(message, **options, &block)
      broadcast("updated", message, **options, &block)
    end

    def deleted(message, **options, &block)
      broadcast("deleted", message, **options, &block)
    end

    private

    def broadcast(event, message, skip_user_ids: [], raise_on_failure: false, &block)
      # Per-user delivery is intentional: block state changes the serialized
      # message and must never leak blocked text or attachment URLs through a
      # shared conversation broadcast.
      broadcast_to_recipients(event, message, skip_user_ids:, raise_on_failure:, &block)
    end

    def broadcast_to_recipients(event, message, skip_user_ids:, raise_on_failure:, &block)
      failures = []
      skipped_recipients = skip_user_ids.to_set
      shared = build_shared_context(message)

      message.destination.recipients.find_in_batches(batch_size: 500) do |batch|
        recipients = batch.reject { |user| skipped_recipients.include?(user.id) }
        next if recipients.empty?

        batch_context = build_batch_context(message, recipients, shared)
        recipients.each do |user|
          begin
            # The event is sent before its durable recipient checkpoint. This is
            # at-least-once delivery, so consumers must deduplicate retried events.
            UserMessagesChannel.broadcast_to(user, payload_for_user(event, message, user, shared:, batch: batch_context))
          rescue StandardError => e
            log_failure(e, user)
            failures << e
            next
          end
          block&.call(user)
        end
      end
      if raise_on_failure && failures.any?
        count = failures.size
        raise BroadcastFailures, "#{count} recipient broadcast #{count == 1 ? 'failure' : 'failures'}", cause: failures.first
      end
    end

    def log_failure(e, user)
      Rails.logger.warn("MessageBroadcastService: broadcast failed user_id=#{user.id}: #{e.class}: #{e.message}")
    end

    def build_shared_context(message)
      ActiveRecord::Associations::Preloader.new(
        records: [ message ],
        associations: [ :author, :message_attachments, { message_reactions: :user } ]
      ).call
      reply_count = if message.association(:replies).loaded?
        message.replies.count { |reply| reply.deleted_at.nil? }
      else
        message.replies.visible.count
      end

      if message.channel
        channel = message.channel
        workspace = channel.workspace
        cohort = channel.cohort
        school_features = FeatureSwitches.school
        peer_space_channel = Channel.self_paced_peer_space_enabled?(cohort, school: school_features)
        latest_message = channel.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first

        {
          reply_count: reply_count,
          channel: channel,
          workspace: workspace,
          cohort: cohort,
          peer_space_channel: peer_space_channel,
          latest_message: latest_message
        }
      else
        conversation = message.direct_conversation
        latest_message = conversation.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first
        {
          reply_count: reply_count,
          latest_message: latest_message
        }
      end
    end

    def build_batch_context(message, recipients, shared)
      recipient_ids = recipients.map(&:id)
      author_ids = [ message.author_id, shared[:latest_message]&.author_id ].compact.uniq
      blocked_pairs = blocked_pairs_for(author_ids, recipient_ids)

      if shared[:channel]
        channel = shared[:channel]
        context = {
          blocked_pairs: blocked_pairs,
          read_states: ChannelReadState.where(channel_id: channel.id, user_id: recipient_ids).index_by(&:user_id),
          muted_user_ids: MessagePreference.where(user_id: recipient_ids, target: channel, muted: true).pluck(:user_id).to_set,
          unread_counts: channel_unread_counts(channel, recipient_ids)
        }
        if shared[:peer_space_channel]
          cohort = shared[:cohort]
          enrollments_by_user = cohort.enrollments.with_read_access.where(user_id: recipient_ids).index_by(&:user_id)
          enrollments_by_user.each_value { |enrollment| enrollment.association(:cohort).target = cohort }
          context[:posting] = {
            now: Time.current,
            enrollments_by_user: enrollments_by_user,
            assigned_instructor_ids: cohort.cohort_instructor_assignments.where(user_id: recipient_ids).pluck(:user_id).to_set
          }
        end
        context
      else
        { blocked_pairs: blocked_pairs }
      end
    end

    def blocked_pairs_for(author_ids, recipient_ids)
      pairs = Set.new
      return pairs if author_ids.empty? || recipient_ids.empty?

      UserBlock.where(blocker_id: author_ids, blocked_user_id: recipient_ids)
        .or(UserBlock.where(blocker_id: recipient_ids, blocked_user_id: author_ids))
        .pluck(:blocker_id, :blocked_user_id)
        .each do |blocker_id, blocked_user_id|
          pairs << [ blocker_id, blocked_user_id ]
          pairs << [ blocked_user_id, blocker_id ]
        end
      pairs
    end

    def channel_unread_counts(channel, recipient_ids)
      return {} if recipient_ids.empty?

      join_read_states = ApplicationRecord.sanitize_sql_array([
        "LEFT JOIN channel_read_states message_read_states ON message_read_states.channel_id = ? AND message_read_states.user_id = users.id",
        channel.id
      ])
      join_messages = ApplicationRecord.sanitize_sql_array([
        "INNER JOIN messages ON messages.channel_id = ? AND messages.deleted_at IS NULL AND messages.author_id <> users.id",
        channel.id
      ])

      User.where(id: recipient_ids)
        .joins(join_read_states)
        .joins(join_messages)
        .then { |scope| MessageReadCursor.after_joined(scope, "message_read_states") }
        .group("users.id")
        .count
    end

    def payload_for_user(event, message, user, shared: nil, batch: nil)
      shared ||= build_shared_context(message)
      batch ||= build_batch_context(message, [ user ], shared)
      blocked_pairs = batch[:blocked_pairs]
      message_blocked = user.id != message.author_id && blocked_pairs.include?([ user.id, message.author_id ])

      {
        event: event,
        channel_id: message.channel_id,
        direct_conversation_id: message.direct_conversation_id,
        message: MessageJson.render(
          message,
          current_user: user,
          stream_url: true,
          read_receipts: read_receipts_for(message, user),
          blocked: message_blocked,
          reply_count: shared[:reply_count]
        ),
        channel: shared[:channel] && channel_json(shared[:channel], user, shared:, batch:),
        direct_conversation: message.direct_conversation && direct_conversation_json(message.direct_conversation, user, shared:, batch:)
      }
    end

    def channel_json(channel, user, shared:, batch:)
      read_state = batch[:read_states][user.id]
      latest_message = shared[:latest_message]
      latest_blocked = latest_message && user.id != latest_message.author_id && batch[:blocked_pairs].include?([ user.id, latest_message.author_id ])

      payload = {
        id: channel.id,
        workspace_id: channel.workspace_id,
        workspace_name: shared[:workspace].name,
        workspace_type: shared[:workspace].workspace_type,
        cohort_id: channel.cohort_id,
        cohort_name: shared[:cohort]&.name,
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
        status: channel.status,
        position: channel.position,
        muted: batch[:muted_user_ids].include?(user.id),
        unread_count: batch[:unread_counts].fetch(user.id, 0),
        last_read_at: read_state&.last_read_at,
        last_read_message_id: read_state&.last_read_message_id,
        latest_message: MessageJson.latest(latest_message, current_user: user, blocked: latest_blocked),
        created_at: channel.created_at,
        updated_at: channel.updated_at
      }

      if shared[:peer_space_channel]
        posting = channel_posting_state(channel, user, shared[:workspace], batch[:posting])
        payload[:can_post] = posting[:can_post]
        payload[:post_disabled_reason] = posting[:post_disabled_reason]
      end

      payload
    end

    def channel_posting_state(channel, user, workspace, posting_context)
      enrollment = posting_context[:enrollments_by_user][user.id]
      active_enrollment = if enrollment&.status == "active" && (enrollment.access_expires_at.nil? || enrollment.access_expires_at > posting_context[:now])
        enrollment
      end
      visible = channel_visible_for_peer_space_user?(channel, user, workspace, enrollment, active_enrollment, posting_context[:assigned_instructor_ids])
      can_post = channel.can_post?(user, visible: visible, enrollment: active_enrollment)
      {
        can_post: can_post,
        post_disabled_reason: can_post ? nil : channel.post_disabled_reason(user, visible: visible, enrollment: active_enrollment)
      }
    end

    def channel_visible_for_peer_space_user?(channel, user, workspace, read_enrollment, active_enrollment, assigned_instructor_ids)
      return false unless user && !user.archived? && workspace.active?

      if user.admin?
        true
      elsif user.instructor?
        assigned_instructor_ids.include?(user.id)
      else
        return false if channel.staff_only?
        return false if read_enrollment&.paused?

        active_enrollment.present?
      end
    end

    def direct_conversation_json(conversation, user, shared:, batch:)
      member = conversation.direct_conversation_members.find_by(user: user)
      latest_message = shared[:latest_message]
      latest_blocked = latest_message && user.id != latest_message.author_id && batch[:blocked_pairs].include?([ user.id, latest_message.author_id ])

      {
        id: conversation.id,
        workspace_id: conversation.workspace_id,
        workspace_name: conversation.workspace.name,
        workspace_type: conversation.workspace.workspace_type,
        cohort_id: conversation.cohort_id,
        cohort_name: conversation.cohort&.name,
        title: conversation.title_for(user),
        status: conversation.status,
        muted: muted?(user, conversation),
        unread_count: direct_unread_count(conversation, user, member),
        last_read_at: member&.last_read_at,
        last_read_message_id: member&.last_read_message_id,
        latest_message: MessageJson.latest(latest_message, current_user: user, blocked: latest_blocked),
        users: conversation.users.map { |member_user| user_json(member_user) },
        created_at: conversation.created_at,
        updated_at: conversation.updated_at
      }
    end

    def direct_unread_count(conversation, user, member)
      messages = conversation.messages.visible.where.not(author_id: user.id)
      messages = MessageReadCursor.after(messages, member)
      messages.count
    end

    def muted?(user, target)
      MessagePreference.exists?(user: user, target: target, muted: true)
    end

    def user_json(user)
      {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        is_staff: user.staff?,
        is_admin: user.admin?
      }
    end

    def read_receipts_for(message, user)
      return nil unless message.author_id == user.id

      readers =
        if message.channel
          member_ids = message.channel.recipients.reorder(nil).where.not(id: message.author_id).select(:id)
          ChannelReadState.includes(:user)
            .where(channel: message.channel, user_id: member_ids)
            .to_a
        else
          message.direct_conversation.direct_conversation_members.includes(:user)
            .where.not(user_id: message.author_id)
            .to_a
        end
      readers.select! { |reader| MessageReadCursor.seen?(reader, message) }

      {
        count: readers.size,
        users: readers.map { |reader| receipt_user_json(reader.user) }
      }
    end

    def receipt_user_json(user)
      {
        id: user.id,
        full_name: user.full_name,
        avatar_url: user.avatar_url
      }
    end
  end
end
