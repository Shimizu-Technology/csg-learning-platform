class InterventionFollowUpJob < ApplicationJob
  queue_as :default

  def perform(now = Time.current)
    Intervention.due(now).includes(enrollment: :user).find_each do |intervention|
      next if intervention.follow_up_notified_at.present? && intervention.follow_up_notified_at >= intervention.next_follow_up_at

      intervention.with_lock do
        next unless intervention.active? && intervention.next_follow_up_at.present? && intervention.next_follow_up_at <= now
        next if intervention.follow_up_notified_at.present? && intervention.follow_up_notified_at >= intervention.next_follow_up_at

        NotificationDeliveryService.intervention_follow_up_due(intervention)
        intervention.update!(follow_up_notified_at: now)
      end
    end
  end
end
