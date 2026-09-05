class MessageDeliveryRecoveryJob < ApplicationJob
  queue_as :default

  def perform
    Message.delivery_recovery_due.find_each(batch_size: 100) do |message|
      MessageDeliveryService.created(message)
    rescue StandardError => error
      Rails.logger.error(
        "[MessageDeliveryRecoveryJob] message_id=#{message.id} " \
        "error=#{error.class}: #{error.message}"
      )
    end
  end
end
