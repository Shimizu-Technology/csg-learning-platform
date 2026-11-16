# Tells admins about a new Safety item or a course purchase (L-3.5).
#
# Callers request it inside the write's transaction; ApplicationJob defers the
# enqueue until that transaction commits (and drops it on rollback), so on the
# inline adapter the alert is created and pushed after the commit, never while
# a row lock is held. Duplicate requests are harmless: each admin gets at most
# one notification per record.
class AdminAlertJob < ApplicationJob
  queue_as :default

  RECORD_TYPES = %w[ContentReport DataDeletionRequest CoursePurchase].freeze

  discard_on ActiveJob::DeserializationError

  def perform(record_type, record_id)
    raise ArgumentError, "Unsupported admin alert: #{record_type}" unless RECORD_TYPES.include?(record_type)

    record = record_type.constantize.find_by(id: record_id)
    NotificationDeliveryService.admin_alert(record) if record
  end
end
