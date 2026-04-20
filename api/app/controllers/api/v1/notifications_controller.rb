module Api
  module V1
    class NotificationsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_notification, only: [ :mark_read ]

      # GET /api/v1/notifications
      def index
        notifications = current_user.notifications.includes(:actor, :notifiable).recent.limit(limit_param)

        render json: {
          notifications: notifications.map { |notification| notification_json(notification) },
          unread_count: current_user.notifications.unread.count
        }
      end

      # PATCH /api/v1/notifications/:id/read
      def mark_read
        @notification.mark_read!
        render json: {
          notification: notification_json(@notification),
          unread_count: current_user.notifications.unread.count
        }
      end

      # PATCH /api/v1/notifications/mark_all_read
      def mark_all_read
        current_user.notifications.unread.update_all(read_at: Time.current, updated_at: Time.current)
        render json: { unread_count: 0 }
      end

      private

      def set_notification
        @notification = current_user.notifications.find(params[:id])
      end

      def limit_param
        params.fetch(:limit, 50).to_i.clamp(1, 100)
      end

      def notification_json(notification)
        {
          id: notification.id,
          notification_type: notification.notification_type,
          title: notification.title,
          body: notification.body,
          path: notification.path,
          read_at: notification.read_at,
          created_at: notification.created_at,
          actor: notification.actor && {
            id: notification.actor.id,
            full_name: notification.actor.full_name,
            email: notification.actor.email
          },
          notifiable: {
            type: notification.notifiable_type,
            id: notification.notifiable_id
          }
        }
      end
    end
  end
end
