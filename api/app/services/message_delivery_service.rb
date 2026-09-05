class MessageDeliveryService
  # Production can run Active Job inline, so request/replay recovery—not an
  # assumed background worker—is the guaranteed execution path for delivery.
  class StaleDeliveryClaim < StandardError; end
  class DeliveryLockTimeout < StandardError; end

  DELIVERY_LEASE = 5.minutes
  LEASE_RENEWAL_INTERVAL = 1.minute
  DELIVERY_LOCK_NAMESPACE = 4_853_470_000_000_000
  DELIVERY_LOCK_WAIT = 5.seconds
  DELIVERY_LOCK_RETRY_INTERVAL = 0.05
  RECIPIENT_CHECKPOINT_BATCH_SIZE = 25

  class << self
    def created(message)
      synchronize_delivery(message) { deliver_created(message) }
    end

    def synchronize_delivery(message, wait_budget: DELIVERY_LOCK_WAIT)
      # A session-level advisory lock orders a soft-delete state reset after any
      # in-flight create fan-out without holding an Active Record row lock over
      # external notification or Action Cable work.
      lock_key = DELIVERY_LOCK_NAMESPACE + message.id
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        locked = false
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + wait_budget.to_f
        loop do
          locked = ActiveModel::Type::Boolean.new.cast(
            connection.select_value("SELECT pg_try_advisory_lock(#{connection.quote(lock_key)})")
          )
          break if locked

          remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
          raise DeliveryLockTimeout, "message delivery is already active" if remaining <= 0

          sleep [ DELIVERY_LOCK_RETRY_INTERVAL, remaining ].min
        end
        yield
      ensure
        connection.select_value("SELECT pg_advisory_unlock(#{connection.quote(lock_key)})") if locked
      end
    end

    private

    def deliver_created(message)
      message.reload
      if message.deleted?
        return unless deliver_message_broadcast(message)

        deliver_thread_broadcast(message) if message.parent_message
        return
      end

      return unless deliver_notifications(message)
      return unless deliver_message_broadcast(message)

      deliver_thread_broadcast(message) if message.parent_message
    end

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
      synchronize_delivery(message) do
        deliver_broadcast_locked(
          message,
          event:,
          completed_attribute:,
          started_attribute:,
          claim_attribute:,
          recipients_attribute:
        )
      end
    end

    def deliver_broadcast_locked(message, event:, completed_attribute:, started_attribute:, claim_attribute:, recipients_attribute:)
      claim = claim_delivery(message, completed_attribute, started_attribute, claim_attribute)
      return true if claim == :complete
      return false if claim == :in_progress

      pending_ids = []
      last_checkpoint_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      delivered_ids = message.reload.delivered_recipient_ids(recipients_attribute)
      broadcast_message = event == :created ? message : Message.find_by(id: message.reload.parent_message_id)
      unless broadcast_message
        completed = complete_delivery(message, completed_attribute, started_attribute, claim_attribute, claim, recipients_attribute)
        raise StaleDeliveryClaim, "message delivery claim expired" unless completed

        return true
      end
      broadcast_event = event == :created && message.deleted? ? :deleted : event
      MessageBroadcastService.public_send(broadcast_event, broadcast_message, skip_user_ids: delivered_ids, raise_on_failure: true) do |user|
        pending_ids << user.id
        elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - last_checkpoint_at
        next if pending_ids.size < RECIPIENT_CHECKPOINT_BATCH_SIZE && elapsed < LEASE_RENEWAL_INTERVAL

        checkpointed = checkpoint_recipients(message, recipients_attribute, started_attribute, claim_attribute, claim, pending_ids)
        raise StaleDeliveryClaim, "message delivery claim expired" unless checkpointed

        last_checkpoint_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
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
