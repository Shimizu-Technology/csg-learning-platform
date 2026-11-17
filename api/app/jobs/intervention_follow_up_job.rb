class InterventionFollowUpJob < ApplicationJob
  queue_as :default

  def perform(now = Time.current)
    notifications = Intervention.transaction do
      # Lock and re-evaluate all due records together; row locks also serialize
      # staff date/owner edits and any intentionally restored queue runner.
      interventions = Intervention.due(now)
        .where("follow_up_notified_at IS NULL OR follow_up_notified_at < next_follow_up_at")
        .order(:id).lock.includes(:owner, enrollment: [ :user, :cohort ]).to_a
      User.preload_assigned_cohort_ids(interventions.map(&:owner))
      interventions.select!(&:owner_valid?)
      next [] if interventions.empty?

      rows = interventions.map do |intervention|
        { notifiable_type: "Intervention", notifiable_id: intervention.id, user_id: intervention.owner_id,
          actor_id: nil, notification_type: Notification.notification_types.fetch("intervention"),
          title: "Follow-up due for #{intervention.enrollment.user.full_name}", body: intervention.trigger_type.humanize,
          path: "/admin/interventions/#{intervention.id}", read_at: nil,
          email_application: ProviderEmailProvenance.marker, created_at: now, updated_at: now }
      end
      ids = Notification.upsert_all(rows, unique_by: :index_notifications_unique_source_per_user, record_timestamps: false,
        update_only: %i[actor_id notification_type title body path read_at updated_at], returning: %w[id]).rows.flatten
      # This mark is an at-most-once provider claim. Commit it and the in-app
      # notices BEFORE external sends: rolling back a mark after an accepted
      # push would duplicate it on recovery.
      Intervention.where(id: interventions.map(&:id)).update_all(follow_up_notified_at: now, updated_at: now)
      Notification.where(id: ids).to_a
    end
    return if notifications.empty?

    failure = nil
    [ WebPushNotificationService, ExpoPushNotificationService ].each do |provider|
      provider.intervention_follow_ups(notifications)
    rescue StandardError => error
      failure ||= error
    end
    raise failure if failure
  end
end
