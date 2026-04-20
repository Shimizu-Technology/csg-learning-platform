module Api
  module V1
    class AnnouncementsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :create, :update, :destroy ]
      before_action :set_announcement, only: [ :show, :update, :destroy ]

      # GET /api/v1/announcements
      def index
        announcements = if current_user.staff? && params[:scope] == "manage"
          Announcement.includes(:cohort, :author).ordered
        else
          Announcement.visible_for(current_user).includes(:cohort, :author).ordered
        end
        paged_announcements = announcements.limit(limit_param).to_a
        notification_index = current_user.notifications
          .where(notifiable_type: "Announcement", notifiable_id: paged_announcements.map(&:id))
          .index_by(&:notifiable_id)

        render json: {
          announcements: paged_announcements.map { |announcement| announcement_json(announcement, notification_index[announcement.id]) },
          unread_count: current_user.notifications.announcement.unread.count
        }
      end

      # GET /api/v1/announcements/:id
      def show
        unless can_view?(@announcement)
          render_forbidden("Announcement is not visible")
          return
        end

        notification = current_user.notifications.find_by(notifiable: @announcement)
        notification&.mark_read!
        render json: { announcement: announcement_json(@announcement, notification) }
      end

      # POST /api/v1/announcements
      def create
        announcement = Announcement.new(announcement_params)
        announcement.author = current_user

        if announcement.save
          NotificationDeliveryService.announcement_published(announcement, push: send_push?)
          render json: { announcement: announcement_json(announcement) }, status: :created
        else
          render json: { errors: announcement.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/announcements/:id
      def update
        was_published = @announcement.published?

        if @announcement.update(announcement_params)
          if !was_published && @announcement.published?
            NotificationDeliveryService.announcement_published(@announcement, push: send_push?)
          end
          render json: { announcement: announcement_json(@announcement) }
        else
          render json: { errors: @announcement.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/announcements/:id
      def destroy
        @announcement.update!(status: :archived, archived_at: Time.current)
        render json: { announcement: announcement_json(@announcement) }
      end

      private

      def set_announcement
        @announcement = Announcement.find(params[:id])
      end

      def announcement_params
        permitted = params.permit(:title, :body, :audience, :cohort_id, :status, :pinned, :published_at)
        permitted[:cohort_id] = nil if permitted.key?(:audience) && permitted[:audience] != "cohort"
        permitted
      end

      def send_push?
        ActiveModel::Type::Boolean.new.cast(params[:send_push])
      end

      def limit_param
        [ params.fetch(:limit, 50).to_i.clamp(1, 100), 100 ].min
      end

      def can_view?(announcement)
        return true if current_user.staff?

        Announcement.visible_for(current_user).where(id: announcement.id).exists?
      end

      def announcement_json(announcement, notification = nil)
        {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          audience: announcement.audience,
          status: announcement.status,
          pinned: announcement.pinned,
          published_at: announcement.published_at,
          archived_at: announcement.archived_at,
          cohort_id: announcement.cohort_id,
          cohort_name: announcement.cohort&.name,
          author: {
            id: announcement.author.id,
            full_name: announcement.author.full_name,
            email: announcement.author.email
          },
          read_at: notification&.read_at,
          created_at: announcement.created_at,
          updated_at: announcement.updated_at
        }
      end
    end
  end
end
