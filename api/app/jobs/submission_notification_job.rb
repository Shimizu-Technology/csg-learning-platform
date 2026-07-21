class SubmissionNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveRecord::RecordNotFound

  def perform(event, submission_id)
    submission = Submission.find(submission_id)

    case event.to_s
    when "created"
      return if submission.grade.present?

      NotificationDeliveryService.submission_created(submission)
    when "graded"
      NotificationDeliveryService.submission_graded(submission)
    else
      raise ArgumentError, "Unsupported submission notification event: #{event}"
    end
  end
end
