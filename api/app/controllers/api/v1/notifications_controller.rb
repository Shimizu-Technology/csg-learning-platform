module Api
  module V1
    class NotificationsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_notification, only: [ :mark_read ]

      # GET /api/v1/notifications
      def index
        notifications_scope = apply_index_filters(scoped_notifications)
        total_count = notifications_scope.count
        notifications = notifications_scope
          .includes(:actor, :notifiable)
          .offset((page_param - 1) * per_page_param)
          .limit(per_page_param)

        render json: {
          notifications: notifications.map { |notification| notification_json(notification) },
          unread_count: scoped_notifications.unread.count,
          meta: pagination_json(total_count)
        }
      end

      # PATCH /api/v1/notifications/:id/read
      def mark_read
        @notification.mark_read!
        render json: {
          notification: notification_json(@notification),
          unread_count: scoped_notifications.unread.count
        }
      end

      # PATCH /api/v1/notifications/mark_all_read
      def mark_all_read
        scoped_notifications.unread.update_all(read_at: Time.current, updated_at: Time.current)
        render json: { unread_count: 0 }
      end

      private

      def set_notification
        @notification = current_user.notifications.find(params[:id])
      end

      def scoped_notifications
        notifications = current_user.notifications
        return notifications unless params[:notification_type].present?
        return notifications unless Notification.notification_types.key?(params[:notification_type])

        notifications.where(notification_type: params[:notification_type])
      end

      def apply_index_filters(scope)
        scoped = scope
        scoped = scoped.where(read_at: nil) if params[:read] == "unread"
        scoped = scoped.where.not(read_at: nil) if params[:read] == "read"

        case params[:sort]
        when "created_asc"
          scoped.order(created_at: :asc)
        when "read_desc"
          scoped.order(read_at: :desc, created_at: :desc)
        when "read_asc"
          scoped.order(read_at: :asc, created_at: :asc)
        else
          scoped.recent
        end
      end

      def page_param
        params.fetch(:page, 1).to_i.clamp(1, 10_000)
      end

      def per_page_param
        if params[:per_page].present?
          params[:per_page].to_i.clamp(1, 100)
        else
          params.fetch(:limit, 50).to_i.clamp(1, 100)
        end
      end

      def pagination_json(total_count)
        total_pages = (total_count.to_f / per_page_param).ceil

        {
          page: page_param,
          per_page: per_page_param,
          total_count: total_count,
          total_pages: total_pages,
          has_next_page: page_param < total_pages,
          has_prev_page: page_param > 1
        }
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
