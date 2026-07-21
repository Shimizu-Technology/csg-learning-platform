class SubmissionNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveRecord::RecordNotFound

  def perform(event, submission_id, event_at)
    submission = Submission.find(submission_id)
    occurred_at = Time.iso8601(event_at)

    case event.to_s
    when "created"
      return if submission.grade.present? || !same_instant?(submission.created_at, occurred_at)

      NotificationDeliveryService.submission_created(submission, event_at: occurred_at)
    when "graded"
      return unless same_instant?(submission.graded_at, occurred_at)

      NotificationDeliveryService.submission_graded(submission, event_at: occurred_at)
    else
      raise ArgumentError, "Unsupported submission notification event: #{event}"
    end
  end

  private

  def same_instant?(recorded_at, event_at)
    recorded_at&.iso8601(6) == event_at.iso8601(6)
  end
end
