module Api
  module V1
    # The signed-in person's shared editor preferences (U-6.8): the mode every
    # editor opens in and whether Enter sends in the message composer. Stored on
    # the account so they follow the person across browsers and devices; the
    # session response carries the current values.
    class EditorPreferencesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      # PATCH /api/v1/editor_preferences
      # Either field may be sent alone; a field that isn't sent keeps its value.
      def update
        changes = {}
        if params.key?(:mode)
          mode = params[:mode].presence
          unless mode.is_a?(String) && User::EDITOR_MODES.include?(mode)
            return render json: { error: "mode must be rich or markdown" }, status: :unprocessable_entity
          end
          changes[:editor_mode] = mode
        end
        if params.key?(:enter_sends)
          unless [ true, false ].include?(params[:enter_sends])
            return render json: { error: "enter_sends must be true or false" }, status: :unprocessable_entity
          end
          changes[:editor_enter_sends] = params[:enter_sends]
        end
        if changes.empty?
          return render json: { error: "Send mode or enter_sends" }, status: :unprocessable_entity
        end

        # Only these columns: a preference isn't a profile edit, so it leaves updated_at alone.
        current_user.update_columns(changes)
        render json: { editor_preferences: current_user.editor_preferences }
      end
    end
  end
end
