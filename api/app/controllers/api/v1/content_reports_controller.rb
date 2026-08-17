module Api
  module V1
    class ContentReportsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :update ]

      def index
        reports = ContentReport.includes(:reporter, :reported_user, :message, :reviewed_by).recent_first.limit(200)
        reports = reports.where(status: params[:status]) if ContentReport.statuses.key?(params[:status])
        render json: { content_reports: reports.map { |report| report_json(report) } }
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
        report.assign_attributes(reason: report_params[:reason], details: report_params[:details]) if report.new_record?
        report.save!
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
        report = ContentReport.find(params[:id])
        status = review_params[:status].to_s
        unless %w[reviewing actioned dismissed].include?(status)
          render json: { errors: [ "Status must be reviewing, actioned, or dismissed" ] }, status: :unprocessable_entity
          return
        end

        report.status = status
        report.reviewed_by = current_user
        report.resolved_at = Time.current if report.status_actioned? || report.status_dismissed?
        report.save!
        render json: { content_report: report_json(report) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

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

      def report_json(report)
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
            created_at: report.message.created_at
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
