module Api
  module V1
    class AnnouncementsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!, only: [ :create, :update, :destroy ]
      before_action :set_announcement, only: [ :show, :update, :destroy ]
      before_action :authorize_announcement_management!, only: [ :create, :update, :destroy ]

      # GET /api/v1/announcements
      def index
        audience_scope = apply_audience_filters(base_announcements_scope)
        unless current_user.staff?
          enabled_ids = current_user.accessible_cohorts.select { |cohort| FeatureSwitches.for(cohort: cohort)["announcements"] }.map(&:id)
          audience_scope = audience_scope.where(cohort_id: enabled_ids + (FeatureSwitches.for(cohort: announcement_context_cohort)["announcements"] ? [ nil ] : []))
        end
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
        require_feature!("announcements", @announcement.cohort || announcement_context_cohort)
        return if performed?

        unless can_view?(@announcement) || can_manage_view?(@announcement)
          render_forbidden("Announcement is not visible")
          return
        end

        notification = current_user.notifications.find_by(notifiable: @announcement)
        notification&.mark_read!
        render json: { announcement: announcement_json(@announcement, notification) }
      end

      # POST /api/v1/announcements
      #
      # A new update is either posted (status "published", the default) or
      # saved as a draft. Drafts notify nobody. A client may send
      # `client_request_id` (8-64 letters, digits, "-" or "_"); a retry or a
      # second click with the same id returns the update the first request
      # made instead of posting, and notifying everyone, twice.
      def create
        announcement = Announcement.new(announcement_params)
        announcement.author = current_user
        announcement.client_request_id = client_request_id
        unless announcement.draft? || announcement.published?
          render json: { errors: [ "A new update is posted or saved as a draft" ] }, status: :unprocessable_entity
          return
        end
        if params[:client_request_id].present? && client_request_id.nil?
          render json: { errors: [ "Client request id must be 8 to 64 letters, digits, dashes or underscores" ] }, status: :unprocessable_entity
          return
        end
        if (replayed = replayed_announcement)
          render json: { announcement: announcement_json(replayed) }, status: :created
          return
        end

        # The in-app notifications are written in the same transaction as the
        # update, so it is posted with every recipient's notification or not
        # at all. Push is requested here and runs after the commit (#258).
        saved = Announcement.transaction do
          next false unless announcement.save

          announce(announcement) if announcement.published?
          true
        end

        if saved
          render json: { announcement: announcement_json(announcement) }, status: :created
        else
          render json: { errors: announcement.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        # Another request with the same client id committed first; its
        # transaction, notifications included, is the one that counts.
        replayed = replayed_announcement
        raise unless replayed

        render json: { announcement: announcement_json(replayed) }, status: :created
      end

      # PATCH /api/v1/announcements/:id
      #
      # The author or an admin edits a draft, posts it (status "published"),
      # or edits a posted update's title and body. Every check runs again
      # under the row lock, against the row as it is now: another request
      # (an admin moving a draft to another cohort, say) may have changed it
      # since this request loaded it. Posting notifies the audience once: the
      # lock makes a double click or retry see the update already posted. The
      # in-app notifications are written under the lock, from the locked row,
      # so they carry the words that were posted and an edit waiting on the
      # lock updates them afterwards. Push runs after the commit (#258).
      # Edits after posting notify nobody again; the audience is fixed.
      def update
        outcome = Announcement.transaction do
          @announcement.lock!
          refresh_management_authorization!
          next :not_editor unless @announcement.editable_by?(current_user)
          next :cannot_manage unless can_manage?(@announcement)

          never_posted = @announcement.draft? || @announcement.published_at.nil?
          @announcement.assign_attributes(announcement_params)
          # The audience it would have after this request.
          next :cannot_manage unless can_manage?(@announcement)

          @announcement.record_edit(current_user)
          copy_changed = !@announcement.draft? && (@announcement.will_save_change_to_title? || @announcement.will_save_change_to_body?)
          next :invalid unless @announcement.save

          if never_posted && @announcement.published?
            announce(@announcement)
          elsif copy_changed
            # Notifications already sent show the current words; nobody is told again.
            Notification.where(notifiable: @announcement).update_all(title: @announcement.title, body: @announcement.body, updated_at: Time.current)
          end
          :saved
        end

        case outcome
        when :saved then render json: { announcement: announcement_json(@announcement) }
        when :not_editor then render_forbidden("Only the author or an admin can change this update")
        when :cannot_manage then render_forbidden("Cannot manage this announcement")
        else render json: { errors: @announcement.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/announcements/:id
      #
      # Archives a posted update. A draft was never sent, so deleting it
      # removes it; the response carries its last state.
      def destroy
        # Under the row lock, so a draft being posted at the same moment is
        # archived after it posts rather than deleted, and the checks see the
        # audience the row has now.
        refusal = Announcement.transaction do
          @announcement.lock!
          refresh_management_authorization!
          if !can_manage?(@announcement)
            "Cannot manage this announcement"
          elsif !@announcement.draft?
            @announcement.update!(status: :archived, archived_at: Time.current)
            nil
          elsif @announcement.editable_by?(current_user)
            @announcement.destroy!
            nil
          else
            "Only the author or an admin can delete this draft"
          end
        end
        return render_forbidden(refusal) if refusal

        render json: { announcement: announcement_json(@announcement) }
      end

      private

      def authorize_announcement_management!
        announcement = @announcement || Announcement.new(announcement_params)
        return if can_manage?(announcement)

        render_forbidden("Cannot manage this announcement")
      end

      # Can post to this audience: admins anywhere, instructors in their cohorts.
      def can_manage?(announcement)
        return false unless current_user.staff? && !current_user.archived?
        return true if current_user.admin?

        announcement.cohort? && teachable_cohort_ids.include?(announcement.cohort_id)
      end

      # Management detail: posted and archived updates for their audience's
      # staff; drafts only for their author and admins.
      def can_manage_view?(announcement)
        can_manage?(announcement) && (!announcement.draft? || announcement.editable_by?(current_user))
      end

      def can_edit?(announcement)
        announcement.editable_by?(current_user) && can_manage?(announcement)
      end

      # Archiving a posted update stays with its audience's staff (the
      # documented decision): any instructor on the cohort, not only the author.
      def can_archive?(announcement)
        announcement.published? && can_manage?(announcement)
      end

      def teachable_cohort_ids
        @teachable_cohort_ids ||= current_user.cohort_instructor_assignments.pluck(:cohort_id).to_set
      end

      def refresh_management_authorization!
        # Both the identity's role/archive state and its cohort assignments
        # may have changed since the before_action. Read both afresh in one
        # statement, bypassing the early check's query and association caches.
        @current_user = User.uncached do
          User.eager_load(cohort_instructor_assignments: :cohort).where(id: current_user.id).load.first!
        end
        assignments = current_user.cohort_instructor_assignments
        @teachable_cohort_ids = assignments.map(&:cohort_id).to_set
        # Reuse the cohort loaded by the fresh check for validation and
        # fan-out, keeping publishing at five statements under the row lock.
        if (assignment = assignments.find { |item| item.cohort_id == @announcement.cohort_id })
          @announcement.cohort = assignment.cohort
        end
      end

      # Posting fans out in the request (no job runner, AS-6). Called inside
      # the posting transaction: the in-app notifications (unique per
      # recipient) commit with the post or roll back with it. Push is
      # requested through PushNotificationJob, which ApplicationJob defers
      # until the commit, so a push failure never undoes the notifications.
      def announce(announcement)
        NotificationDeliveryService.announcement_published(announcement, push: send_push?)
      end

      # A draft someone may not see is "not found", exactly as a missing id
      # is, so the response doesn't reveal that it exists.
      def set_announcement
        @announcement = Announcement.drafts_visible_to(current_user).find_by(id: params[:id])
        render json: { error: "Update not found" }, status: :not_found unless @announcement
      end

      CLIENT_REQUEST_ID = /\A[A-Za-z0-9_-]{8,64}\z/

      def client_request_id
        value = params[:client_request_id]
        value if value.is_a?(String) && CLIENT_REQUEST_ID.match?(value)
      end

      def replayed_announcement
        return unless client_request_id

        Announcement.find_by(author_id: current_user.id, client_request_id: client_request_id)
      end

      # No published_at: posting time is when the update is posted. Scheduled
      # posting waits for a job runner (AS-6).
      def announcement_params
        permitted = params.permit(:title, :body, :audience, :cohort_id, :status, :pinned)
        permitted[:cohort_id] = nil if permitted.key?(:audience) && permitted[:audience] != "cohort"
        permitted
      end

      def send_push?
        ActiveModel::Type::Boolean.new.cast(params[:send_push])
      end

      def announcement_context_cohort
        current_user.accessible_cohorts.find_by(id: params[:cohort_id]) if params[:cohort_id].present?
      end

      def base_announcements_scope
        scope = if current_user.staff? && params[:scope] == "manage"
          managed = current_user.admin? ? Announcement.all : Announcement.where(audience: :cohort, cohort_id: current_user.cohort_instructor_assignments.select(:cohort_id))
          managed.drafts_visible_to(current_user)
        else
          Announcement.visible_for(current_user)
        end

        scope.includes(:cohort, :author, :edited_by)
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
          edited_at: announcement.edited_at,
          edited_by: announcement.edited_by && {
            id: announcement.edited_by.id,
            full_name: announcement.edited_by.full_name
          },
          can_edit: can_edit?(announcement),
          can_archive: can_archive?(announcement),
          created_at: announcement.created_at,
          updated_at: announcement.updated_at
        }
      end
    end
  end
end
