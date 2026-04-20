module Api
  module V1
    class MessagePreferencesController < ApplicationController
      before_action :authenticate_user!

      # PATCH /api/v1/message_preferences
      def update
        target = preference_target
        return if performed?

        unless target.visible_to?(current_user)
          render_forbidden("Conversation is not visible")
          return
        end

        preference = current_user.message_preferences.find_or_initialize_by(target: target)
        preference.muted = ActiveModel::Type::Boolean.new.cast(params[:muted])
        preference.save!

        render json: {
          preference: {
            target_type: preference.target_type,
            target_id: preference.target_id,
            muted: preference.muted
          }
        }
      end

      private

      def preference_target
        case params[:target_type].to_s
        when "Channel"
          Channel.find(params[:target_id])
        when "DirectConversation"
          DirectConversation.find(params[:target_id])
        else
          render json: { error: "target_type must be Channel or DirectConversation" }, status: :unprocessable_entity
          nil
        end
      end
    end
  end
end
