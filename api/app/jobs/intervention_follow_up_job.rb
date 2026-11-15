class InterventionFollowUpJob < ApplicationJob
  queue_as :default

  def perform(now = Time.current)
    Intervention.due(now).includes(enrollment: :user).find_each do |intervention|
      next if intervention.follow_up_notified_at.present? && intervention.follow_up_notified_at >= intervention.next_follow_up_at

      intervention.with_lock do
        next unless intervention.active? && intervention.next_follow_up_at.present? && intervention.next_follow_up_at <= now
        next if intervention.follow_up_notified_at.present? && intervention.follow_up_notified_at >= intervention.next_follow_up_at

        next unless intervention.owner_valid?

        # follow_up_notified_at commits in this transaction and stops every
        # later run from pushing again, so the push is requested inside it:
        # Solid Queue (the only runner of this recurring job) then commits the
        # push job atomically with the mark, and inline it is attempted before
        # the mark, as before after-commit enqueueing. Deferring it would let
        # a crash after the commit leave a follow-up marked notified that was
        # never pushed.
        ApplicationJob.enqueue_within_transaction do
          NotificationDeliveryService.intervention_follow_up_due(intervention)
        end
        intervention.update!(follow_up_notified_at: now)
      end
    end
  end
end
