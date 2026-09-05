class MessageDeliveryRecoveryJob < ApplicationJob
  queue_as :default

  MAX_MESSAGES_PER_RUN = 100

  def perform
    due_messages = Message.delivery_recovery_due.visible
    backlog_size = due_messages.count
    Rails.logger.info(
      "[MessageDeliveryRecoveryJob] backlog_due=#{backlog_size} batch_limit=#{MAX_MESSAGES_PER_RUN}"
    )

    due_messages
      .order(:delivery_recovery_attempted_at, :id)
      .limit(MAX_MESSAGES_PER_RUN)
      .each do |message|
        # Failed work rotates behind untouched messages. Do not silently expire
        # it: there is no operator-owned dead-letter queue to take over delivery.
        message.update_columns(delivery_recovery_attempted_at: Time.current)
        MessageDeliveryService.created(message)
      rescue StandardError => error
        Rails.logger.error(
          "[MessageDeliveryRecoveryJob] message_id=#{message.id} " \
          "error=#{error.class}: #{error.message}"
        )
      end
  end
end
