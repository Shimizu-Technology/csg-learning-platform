module Api
  module V1
    # Staff replies to a help request (U-4.7): "Reply" keeps the request open,
    # "Reply & resolve" (`resolve: true`) closes it. The learner is notified
    # once per reply, after the reply commits.
    class HelpRequestRepliesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def create
        return render_forbidden("Only staff can reply to help requests") unless current_user.staff?

        help_request = HelpRequest.where(cohort_id: current_user.accessible_cohorts.select(:id)).find(params[:help_request_id])
        body = reply_params[:body].to_s
        if body.strip.blank?
          render json: { error: "Write a reply before sending it" }, status: :unprocessable_entity
          return
        end

        resolve = ActiveModel::Type::Boolean.new.cast(reply_params[:resolve]) == true
        reply = help_request.reply!(current_user, body: body, resolve: resolve)
        unless reply
          render json: { error: "Resolved or canceled help requests cannot be changed" }, status: :unprocessable_entity
          return
        end

        # reply! has committed (it holds the row lock only inside its own transaction).
        NotificationDeliveryService.help_request_changed(help_request, reply: reply)
        render json: {
          help_request: HelpRequestSerializer.as_json(help_request.reload, include_student: true, include_follow_up: true),
          reply: HelpRequestSerializer.reply_json(reply)
        }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def reply_params
        params.require(:reply).permit(:body, :resolve)
      end
    end
  end
end
