class MessageDeliveryRecoveryJob < ApplicationJob
  queue_as :default

  MAX_MESSAGES_PER_RUN = 100

  def perform
    Message.delivery_recovery_due
      .order(:delivery_recovery_attempted_at, :id)
      .limit(MAX_MESSAGES_PER_RUN)
      .each do |message|
      begin
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
end
