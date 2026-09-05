class MessageDeliveryService
  # Production can run Active Job inline, so request/replay recovery—not an
  # assumed background worker—is the guaranteed execution path for delivery.
  class StaleDeliveryClaim < StandardError; end

  DELIVERY_LEASE = 5.minutes
  RECIPIENT_CHECKPOINT_BATCH_SIZE = 25

  class << self
    def created(message)
      message.reload
      return unless deliver_notifications(message)
      return unless deliver_message_broadcast(message)

      deliver_thread_broadcast(message) if message.parent_message
    end

    private

    def deliver_notifications(message)
      claim = claim_delivery(message, :notifications_delivered_at, :notifications_delivery_started_at, :notifications_delivery_claim)
      return true if claim == :complete
      return false if claim == :in_progress

      NotificationDeliveryService.message_created(message.reload, push: message.delivery_push_requested?)
      completed = complete_delivery(message, :notifications_delivered_at, :notifications_delivery_started_at, :notifications_delivery_claim, claim)
      raise StaleDeliveryClaim, "notification delivery claim expired" unless completed

      true
    rescue StandardError => delivery_error
      safely_release_delivery(message, :notifications_delivery_started_at, :notifications_delivery_claim, claim) if claim.is_a?(String)
      raise delivery_error
    end

    def deliver_message_broadcast(message)
      deliver_broadcast(
        message,
        event: :created,
        completed_attribute: :broadcasts_delivered_at,
        started_attribute: :broadcast_delivery_started_at,
        claim_attribute: :broadcast_delivery_claim,
        recipients_attribute: :broadcast_recipient_ids
      )
    end

    def deliver_thread_broadcast(message)
      deliver_broadcast(
        message,
        event: :updated,
        completed_attribute: :thread_broadcasts_delivered_at,
        started_attribute: :thread_broadcast_delivery_started_at,
        claim_attribute: :thread_broadcast_delivery_claim,
        recipients_attribute: :thread_broadcast_recipient_ids
      )
    end

    def deliver_broadcast(message, event:, completed_attribute:, started_attribute:, claim_attribute:, recipients_attribute:)
      claim = claim_delivery(message, completed_attribute, started_attribute, claim_attribute)
      return true if claim == :complete
      return false if claim == :in_progress

      pending_ids = []
      delivered_ids = message.reload.delivered_recipient_ids(recipients_attribute)
      broadcast_message = event == :created ? message : message.parent_message.reload
      MessageBroadcastService.public_send(event, broadcast_message, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
        pending_ids << user.id
        next if pending_ids.size < RECIPIENT_CHECKPOINT_BATCH_SIZE

        checkpointed = checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, pending_ids)
        raise StaleDeliveryClaim, "message delivery claim expired" unless checkpointed

        pending_ids.clear
      end
      checkpointed = checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, pending_ids)
      raise StaleDeliveryClaim, "message delivery claim expired" unless checkpointed

      completed = complete_delivery(message, completed_attribute, started_attribute, claim_attribute, claim, recipients_attribute)
      raise StaleDeliveryClaim, "message delivery claim expired" unless completed

      true
    rescue StandardError => delivery_error
      safely_checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, pending_ids) if claim.is_a?(String) && pending_ids&.any?
      safely_release_delivery(message, started_attribute, claim_attribute, claim) if claim.is_a?(String)
      raise delivery_error
    end

    def claim_delivery(message, completed_attribute, started_attribute, claim_attribute)
      message.with_lock do
        next :complete if message.public_send(completed_attribute).present?

        started_at = message.public_send(started_attribute)
        next :in_progress if started_at.present? && started_at > DELIVERY_LEASE.ago

        claim = SecureRandom.uuid
        message.update_columns(started_attribute => Time.current, claim_attribute => claim)
        claim
      end
    end

    def complete_delivery(message, completed_attribute, started_attribute, claim_attribute, claim, recipients_attribute = nil)
      message.with_lock do
        next false unless message.public_send(claim_attribute) == claim

        attributes = {
          completed_attribute => Time.current,
          started_attribute => nil,
          claim_attribute => nil
        }
        attributes[recipients_attribute] = [] if recipients_attribute
        message.update_columns(attributes)
        true
      end
    end

    def release_delivery(message, started_attribute, claim_attribute, claim)
      message.with_lock do
        next false unless message.public_send(claim_attribute) == claim

        message.update_columns(started_attribute => nil, claim_attribute => nil)
        true
      end
    end

    def checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, recipient_ids)
      return true if recipient_ids.empty?

      message.with_lock do
        next false unless message.public_send(claim_attribute) == claim

        delivered_ids = message.delivered_recipient_ids(recipients_attribute)
        message.update_columns(
          recipients_attribute => (delivered_ids + recipient_ids).uniq,
          started_attribute => Time.current
        )
        true
      end
    end

    def safely_checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, recipient_ids)
      checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, recipient_ids)
    rescue StandardError => error
      Rails.logger.warn("MessageDeliveryService: delivery checkpoint cleanup failed: #{error.class}: #{error.message}")
    end

    def safely_release_delivery(message, started_attribute, claim_attribute, claim)
      release_delivery(message, started_attribute, claim_attribute, claim)
    rescue StandardError => error
      Rails.logger.warn("MessageDeliveryService: delivery lease cleanup failed: #{error.class}: #{error.message}")
    end
  end
end
