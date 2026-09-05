class MessageDeliveryService
  class << self
    def created(message)
      message.reload
      deliver_notifications(message)
      deliver_message_broadcast(message)
      deliver_thread_broadcast(message) if message.parent_message
    end

    private

    def deliver_notifications(message)
      message.with_lock do
        next if message.notifications_delivered_at?

        NotificationDeliveryService.message_created(message, push: message.delivery_push_requested?)
        message.update_column(:notifications_delivered_at, Time.current)
      end
    end

    def deliver_message_broadcast(message)
      failure = nil
      message.with_lock do
        next if message.broadcasts_delivered_at?

        begin
          delivered_ids = message.delivered_recipient_ids(:broadcast_recipient_ids)
          MessageBroadcastService.created(message, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
            record_recipient(message, :broadcast_recipient_ids, user.id)
          end
          message.update_column(:broadcasts_delivered_at, Time.current)
        rescue StandardError => e
          failure = e
        end
      end
      raise failure if failure
    end

    def deliver_thread_broadcast(message)
      failure = nil
      message.with_lock do
        next if message.thread_broadcasts_delivered_at?

        begin
          delivered_ids = message.delivered_recipient_ids(:thread_broadcast_recipient_ids)
          MessageBroadcastService.updated(message.parent_message.reload, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
            record_recipient(message, :thread_broadcast_recipient_ids, user.id)
          end
          message.update_column(:thread_broadcasts_delivered_at, Time.current)
        rescue StandardError => e
          failure = e
        end
      end
      raise failure if failure
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
