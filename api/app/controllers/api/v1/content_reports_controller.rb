module Api
  module V1
    class ContentReportsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!, only: [ :index, :show, :update ]

      OPEN_STATUSES = %w[pending reviewing].freeze
      RESOLVED_STATUSES = %w[actioned dismissed].freeze
      # Without a view the list keeps its original shape for installed clients:
      # the 200 most recent reports, newest first.
      LEGACY_LIMIT = 200
      PER_PAGE = 25
      MAX_PER_PAGE = 100

      # GET /api/v1/content_reports
      # view=open: pending and reviewing, oldest first (the queue).
      # view=resolved: actioned and dismissed, most recently resolved first, paginated.
      def index
        view = params[:view].to_s
        reports = ContentReport.all
        reports = reports.where(status: params[:status]) if ContentReport.statuses.key?(params[:status])
        reports = case view
        when "open" then reports.where(status: OPEN_STATUSES).order(created_at: :asc, id: :asc)
        when "resolved" then reports.where(status: RESOLVED_STATUSES).order(resolved_at: :desc, id: :desc)
        else reports.recent_first
        end
        per_page = view.in?(%w[open resolved]) ? per_page_param : LEGACY_LIMIT
        page = view.in?(%w[open resolved]) ? page_param : 1
        total_count = view.in?(%w[open resolved]) ? reports.count : [ reports.count, LEGACY_LIMIT ].min
        page_reports = reports.includes(:reporter, :reported_user, :reviewed_by, message: { channel: :cohort, direct_conversation: :cohort })
          .offset((page - 1) * per_page).limit(per_page).to_a
        access = conversation_access(page_reports)
        render json: {
          content_reports: page_reports.map { |report| report_json(report, access) },
          meta: pagination_json(total_count, page, per_page)
        }
      end

      # GET /api/v1/content_reports/:id — one report, for a Safety link to a
      # report that isn't in the list being shown (an alert for a report since resolved).
      def show
        report = ContentReport.includes(:reporter, :reported_user, :reviewed_by, message: { channel: :cohort, direct_conversation: :cohort }).find(params[:id])
        render json: { content_report: report_json(report, conversation_access([ report ])) }
      end

      def create
        message = report_params[:message_id].present? ? Message.find(report_params[:message_id]) : nil
        unless message.nil? || message.destination.visible_to?(current_user)
          render_forbidden("Message is not visible")
          return
        end

        reported_user = message&.author || User.not_archived.find(report_params[:reported_user_id])
        unless message || shares_visible_workspace?(reported_user)
          render_forbidden("User is not visible")
          return
        end

        report = find_or_initialize_report(message, reported_user)
        created = report.new_record?
        report.assign_attributes(reason: report_params[:reason], details: report_params[:details]) if created
        report.save!
        # A repeat of the same report is not news; only a new one alerts admins.
        AdminAlertJob.perform_later("ContentReport", report.id) if created
        render json: { content_report: report_json(report) }, status: :created
      rescue ActiveRecord::RecordNotUnique
        # A second request can arrive between the lookup and insert. The partial
        # unique indexes are the source of truth, so return the report that won
        # the race instead of surfacing a 500 to the reporter.
        report = find_open_report(message, reported_user)
        render json: { content_report: report_json(report) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def update
        report = ContentReport.includes(:reporter, :reported_user, :reviewed_by, message: { channel: :cohort, direct_conversation: :cohort }).find(params[:id])
        status = review_params[:status].to_s
        unless %w[reviewing actioned dismissed].include?(status)
          render json: { errors: [ "Status must be reviewing, actioned, or dismissed" ] }, status: :unprocessable_entity
          return
        end

        report.status = status
        report.reviewed_by = current_user
        report.resolved_at = Time.current if report.status_actioned? || report.status_dismissed?
        report.save!
        render json: { content_report: report_json(report, conversation_access([ report ])) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def page_param
        params.fetch(:page, 1).to_i.clamp(1, 10_000)
      end

      def per_page_param
        params.fetch(:per_page, PER_PAGE).to_i.clamp(1, MAX_PER_PAGE)
      end

      def pagination_json(total_count, page, per_page)
        total_pages = (total_count.to_f / per_page).ceil
        { page: page, per_page: per_page, total_count: total_count, total_pages: total_pages, has_next_page: page < total_pages, has_prev_page: page > 1 }
      end

      # Which reported messages' conversations this admin can open, in two
      # queries for the whole page. Admins see every class channel, but a direct
      # conversation only opens for its members, so most reported DMs stay text.
      def conversation_access(reports)
        messages = reports.filter_map(&:message)
        channel_ids = messages.filter_map(&:channel_id).uniq
        dm_ids = messages.filter_map(&:direct_conversation_id).uniq
        {
          channels: channel_ids.empty? ? Set.new : Channel.visible_for(current_user).where(id: channel_ids).pluck(:id).to_set,
          dms: dm_ids.empty? ? Set.new : DirectConversation.visible_for(current_user).where(id: dm_ids).pluck(:id).to_set
        }
      end

      def conversation_json(message, access)
        if message.channel_id
          channel = message.channel
          available = access[:channels].include?(message.channel_id)
          label = channel ? [ "##{channel.name}", channel.cohort&.name ].compact.join(" in ") : "A class channel"
          { kind: "channel", label: label, available: available, destination: available ? RecordDestination.build(kind: "channel", id: message.channel_id, anchor: { message_id: message.id }) : nil }
        else
          available = access[:dms].include?(message.direct_conversation_id)
          cohort_name = message.direct_conversation&.cohort&.name
          { kind: "dm", label: [ "Direct conversation", cohort_name ].compact.join(" in "), available: available, destination: available ? RecordDestination.build(kind: "dm", id: message.direct_conversation_id, anchor: { message_id: message.id }) : nil }
        end
      end

      def report_params
        params.require(:content_report).permit(:message_id, :reported_user_id, :reason, :details)
      end

      def review_params
        params.require(:content_report).permit(:status)
      end

      def shares_visible_workspace?(reported_user)
        return true if current_user.staff?

        Workspace.visible_for(current_user).any? do |workspace|
          workspace.recipient_users.reorder(nil).exists?(id: reported_user.id)
        end
      end

      def find_or_initialize_report(message, reported_user)
        return current_user.content_reports.find_or_initialize_by(message: message, reported_user: reported_user) if message

        find_open_report(message, reported_user) || current_user.content_reports.build(message: message, reported_user: reported_user)
      end

      def find_open_report(message, reported_user)
        scope = current_user.content_reports.where(message: message, reported_user: reported_user)
        return scope.first if message

        scope.where(status: %i[pending reviewing]).first
      end

      def report_json(report, access = nil)
        access ||= conversation_access([ report ])
        {
          id: report.id,
          reason: report.reason,
          details: report.details,
          status: report.status,
          created_at: report.created_at,
          resolved_at: report.resolved_at,
          reporter: user_json(report.reporter),
          reported_user: user_json(report.reported_user),
          message: report.message && {
            id: report.message.id,
            body: report.message.body.to_s.truncate(500),
            channel_id: report.message.channel_id,
            direct_conversation_id: report.message.direct_conversation_id,
            created_at: report.message.created_at,
            conversation: conversation_json(report.message, access)
          },
          reviewed_by: report.reviewed_by && user_json(report.reviewed_by)
        }
      end

      def user_json(user)
        { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
      end
    end
  end
end
