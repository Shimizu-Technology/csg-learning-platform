class MessageDeliveryService
  DELIVERY_LEASE = 5.minutes

  class << self
    def created(message)
      message.reload
      return unless deliver_notifications(message)
      return unless deliver_message_broadcast(message)

      deliver_thread_broadcast(message) if message.parent_message
    end

    private

    def deliver_notifications(message)
      claim = claim_delivery(message, :notifications_delivered_at, :notifications_delivery_started_at)
      return true if claim == :complete
      return false if claim == :in_progress

      NotificationDeliveryService.message_created(message.reload, push: message.delivery_push_requested?)
      complete_delivery(message, :notifications_delivered_at, :notifications_delivery_started_at)
      true
    rescue StandardError
      release_delivery(message, :notifications_delivery_started_at) if claim == :claimed
      raise
    end

    def deliver_message_broadcast(message)
      claim = claim_delivery(message, :broadcasts_delivered_at, :broadcast_delivery_started_at)
      return true if claim == :complete
      return false if claim == :in_progress

      delivered_ids = message.reload.delivered_recipient_ids(:broadcast_recipient_ids)
      MessageBroadcastService.created(message, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
        record_recipient(message, :broadcast_recipient_ids, user.id)
      end
      complete_delivery(message, :broadcasts_delivered_at, :broadcast_delivery_started_at, :broadcast_recipient_ids)
      true
    rescue StandardError
      release_delivery(message, :broadcast_delivery_started_at) if claim == :claimed
      raise
    end

    def deliver_thread_broadcast(message)
      claim = claim_delivery(message, :thread_broadcasts_delivered_at, :thread_broadcast_delivery_started_at)
      return true if claim == :complete
      return false if claim == :in_progress

      delivered_ids = message.reload.delivered_recipient_ids(:thread_broadcast_recipient_ids)
      MessageBroadcastService.updated(message.parent_message.reload, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
        record_recipient(message, :thread_broadcast_recipient_ids, user.id)
      end
      complete_delivery(message, :thread_broadcasts_delivered_at, :thread_broadcast_delivery_started_at, :thread_broadcast_recipient_ids)
      true
    rescue StandardError
      release_delivery(message, :thread_broadcast_delivery_started_at) if claim == :claimed
      raise
    end

    def claim_delivery(message, completed_attribute, started_attribute)
      message.with_lock do
        next :complete if message.public_send(completed_attribute).present?

        started_at = message.public_send(started_attribute)
        next :in_progress if started_at.present? && started_at > DELIVERY_LEASE.ago

        message.update_column(started_attribute, Time.current)
        :claimed
      end
    end

    def complete_delivery(message, completed_attribute, started_attribute, recipients_attribute = nil)
      message.with_lock do
        attributes = {
          completed_attribute => Time.current,
          started_attribute => nil
        }
        attributes[recipients_attribute] = [] if recipients_attribute
        message.update_columns(attributes)
      end
    end

    def release_delivery(message, started_attribute)
      message.with_lock do
        message.update_column(started_attribute, nil)
      end
    end

    def record_recipient(message, attribute, user_id)
      message.with_lock do
        delivered_ids = message.delivered_recipient_ids(attribute)
        next if delivered_ids.include?(user_id)

        message.update_column(attribute, delivered_ids + [ user_id ])
      end
    end
  end
end
