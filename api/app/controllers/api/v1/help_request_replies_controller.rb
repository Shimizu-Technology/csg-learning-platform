module Api
  module V1
    # Replies on a help request (U-4.7): staff "Reply" keeps the request open,
    # "Reply & resolve" (`resolve: true`) closes it, and the learner is
    # notified once per reply, after the reply commits. The learner who asked
    # can follow up on their own active request, before or after staff
    # replied; that notifies the staff member who owns it (every cohort staff
    # member when nobody does) and never resolves or reassigns it.
    #
    # A client may send `client_request_id` (8-64 letters, digits, "-" or
    # "_"), one per reply attempt, reused on retry. A retry whose first attempt
    # was saved returns that reply (`replayed: true`) and notifies nobody again,
    # including after that first attempt resolved the request.
    class HelpRequestRepliesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def create
        help_request = if current_user.staff?
          HelpRequest.where(cohort_id: current_user.accessible_cohorts.select(:id)).find(params[:help_request_id])
        elsif current_user.student?
          current_user.help_requests.find(params[:help_request_id])
        end
        return render_forbidden("Only staff and the learner who asked can reply to help requests") unless help_request

        if !current_user.staff? && !learner_can_follow_up?(help_request)
          return if performed?

          return render_forbidden("Instructor support is not available for this course")
        end
        if reply_params[:client_request_id].present? && client_request_id.nil?
          render json: { error: "Client request id must be 8 to 64 letters, digits, dashes or underscores" }, status: :unprocessable_entity
          return
        end
        body = reply_params[:body].to_s
        if body.strip.blank?
          render json: { error: "Write a reply before sending it" }, status: :unprocessable_entity
          return
        end

        return create_follow_up(help_request, body) unless current_user.staff?

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

      def create_follow_up(help_request, body)
        reply = help_request.follow_up!(current_user, body: body, client_request_id: client_request_id)
        unless reply
          render json: { error: "Resolved or canceled help requests cannot be changed" }, status: :unprocessable_entity
          return
        end

        NotificationDeliveryService.help_request_followed_up(help_request, reply: reply) unless reply.replayed
        render_reply(help_request, reply)
      end

      # The same gate as canceling: the course still offers instructor help.
      def learner_can_follow_up?(help_request)
        require_feature!("help_requests", help_request.cohort)
        return false if performed?

        current_user.enrollments.active.find_by(cohort_id: help_request.cohort_id)&.guided_help_available? == true
      end

      def render_reply(help_request, reply)
        record = HelpRequest.includes(:cohort, :student, :owner, replies: :author).find(help_request.id)
        render json: {
          help_request: HelpRequestSerializer.as_json(record, include_student: current_user.staff?, include_follow_up: current_user.staff?),
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
