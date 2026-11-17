module Api
  module V1
    # Staff replies to a help request (U-4.7): "Reply" keeps the request open,
    # "Reply & resolve" (`resolve: true`) closes it. The learner is notified
    # once per reply, after the reply commits.
    #
    # A client may send `client_request_id` (8-64 letters, digits, "-" or
    # "_"), one per reply attempt, reused on retry. A retry whose first attempt
    # was saved returns that reply (`replayed: true`) and notifies nobody again,
    # including after that first attempt resolved the request.
    class HelpRequestRepliesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def create
        return render_forbidden("Only staff can reply to help requests") unless current_user.staff?

        help_request = HelpRequest.where(cohort_id: current_user.accessible_cohorts.select(:id)).find(params[:help_request_id])
        if reply_params[:client_request_id].present? && client_request_id.nil?
          render json: { error: "Client request id must be 8 to 64 letters, digits, dashes or underscores" }, status: :unprocessable_entity
          return
        end
        body = reply_params[:body].to_s
        if body.strip.blank?
          render json: { error: "Write a reply before sending it" }, status: :unprocessable_entity
          return
        end

        resolve = ActiveModel::Type::Boolean.new.cast(reply_params[:resolve]) == true
        reply = help_request.reply!(current_user, body: body, resolve: resolve, client_request_id: client_request_id)
        unless reply
          render json: { error: "Resolved or canceled help requests cannot be changed" }, status: :unprocessable_entity
          return
        end

        # reply! has committed (it holds the row lock only inside its own transaction).
        NotificationDeliveryService.help_request_changed(help_request, reply: reply) unless reply.replayed
        render_reply(help_request, reply)
      rescue ActiveRecord::RecordNotUnique
        # The row lock serializes retries, so this is a backstop: another
        # request with the same client id saved first and notified.
        earlier = client_request_id && help_request.replies.find_by(author_id: current_user.id, client_request_id: client_request_id)
        raise unless earlier

        earlier.replayed = true
        render_reply(help_request, earlier)
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def render_reply(help_request, reply)
        record = HelpRequest.includes(:cohort, :student, :owner, replies: :author).find(help_request.id)
        render json: {
          help_request: HelpRequestSerializer.as_json(record, include_student: true, include_follow_up: true),
          reply: HelpRequestSerializer.reply_json(reply),
          replayed: reply.replayed == true
        }, status: :created
      end

      def client_request_id
        value = reply_params[:client_request_id]
        value if value.is_a?(String) && HelpRequestReply::CLIENT_REQUEST_ID.match?(value)
      end

      def reply_params
        params.require(:reply).permit(:body, :resolve, :client_request_id)
      end
    end
  end
end
