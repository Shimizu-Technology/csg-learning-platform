module Api
  module V1
    class AnnouncementsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :create, :update, :destroy ]
      before_action :set_announcement, only: [ :show, :update, :destroy ]
      before_action :authorize_announcement_management!, only: [ :create, :update, :destroy ]

      # GET /api/v1/announcements
      def index
        audience_scope = apply_audience_filters(base_announcements_scope)
        announcements = apply_sort(apply_read_filter(audience_scope)).order(id: :desc)
        total_count = announcements.count
        paged_announcements = announcements
          .offset((page_param - 1) * per_page_param)
          .limit(per_page_param)
          .to_a
        unread_projection = AnnouncementUnreadProjection.new(current_user, audience_scope)
        notification_index = unread_projection.notifications
          .where(notifiable_id: paged_announcements.map(&:id))
          .index_by(&:notifiable_id)

        render json: {
          announcements: paged_announcements.map { |announcement| announcement_json(announcement, notification_index[announcement.id]) },
          unread_count: unread_projection.count,
          meta: pagination_json(total_count)
        }
      end

      # GET /api/v1/announcements/:id
      def show
        unless can_view?(@announcement) || can_manage?(@announcement)
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
        proposed = @announcement.dup
        proposed.assign_attributes(announcement_params)
        unless (proposed.cohort? && current_user.can_teach_cohort?(proposed.cohort)) || (!proposed.cohort? && current_user.admin?)
          render_forbidden("Cannot manage this announcement")
          return
        end
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

      def authorize_announcement_management!
        announcement = @announcement || Announcement.new(announcement_params)
        return if can_manage?(announcement)

        render_forbidden("Cannot manage this announcement")
      end

      def can_manage?(announcement)
        return false unless current_user.staff?

        announcement.cohort? ? current_user.can_teach_cohort?(announcement.cohort) : current_user.admin?
      end

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

      def base_announcements_scope
        scope = if current_user.staff? && params[:scope] == "manage"
          current_user.admin? ? Announcement.all : Announcement.where(audience: :cohort, cohort_id: current_user.cohort_instructor_assignments.select(:cohort_id))
        else
          Announcement.visible_for(current_user)
        end

        scope.includes(:cohort, :author)
      end

      def apply_audience_filters(scope)
        scoped = scope
        scoped = scoped.where(audience: params[:audience]) if Announcement.audiences.key?(params[:audience].to_s)

        if current_user.staff? && params[:scope] == "manage"
          scoped = scoped.where(status: params[:status]) if Announcement.statuses.key?(params[:status].to_s)
        else
          scoped = scoped.where.not(status: :archived)
        end

        if params[:cohort_id].present?
          if params[:scope] == "manage"
            scoped = scoped.where(cohort_id: params[:cohort_id])
          else
            # Reader context includes school-wide notices; audience=cohort is
            # the explicit exact-cohort filter. Management stays exact.
            scoped = scoped.where(cohort_id: params[:cohort_id]).or(scoped.where(audience: :global))
          end
        end
        scoped
      end

      def apply_read_filter(scope)
        return scope unless %w[read unread].include?(params[:read].to_s)

        unread_notification_ids = current_user.notifications.announcement.unread.select(:notifiable_id)

        if params[:read] == "read"
          scope.where.not(id: unread_notification_ids)
        else
          scope.where(id: unread_notification_ids)
        end
      end

      def apply_sort(scope)
        case params[:sort]
        when "published_asc"
          scope.order(pinned: :desc, published_at: :asc, created_at: :asc)
        when "created_desc"
          scope.order(created_at: :desc)
        when "created_asc"
          scope.order(created_at: :asc)
        when "updated_desc"
          scope.order(updated_at: :desc)
        when "updated_asc"
          scope.order(updated_at: :asc)
        else
          scope.ordered
        end
      end

      def page_param
        params.fetch(:page, 1).to_i.clamp(1, 10_000)
      end

      def per_page_param
        params.fetch(:per_page, 20).to_i.clamp(1, 100)
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

      def can_view?(announcement)
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
          author: announcement.author && {
            id: announcement.author.id,
            full_name: announcement.author.full_name,
            email: announcement.author.email
          },
          read_at: notification&.read_at,
          unread: notification.present? && !notification.read?,
          created_at: announcement.created_at,
          updated_at: announcement.updated_at
        }
      end
    end
  end
end
