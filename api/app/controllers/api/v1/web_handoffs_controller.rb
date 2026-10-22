module Api
  module V1
    class WebHandoffsController < ApplicationController
      ALLOWED_DESTINATIONS = %r{\A(?:
        /(?:lessons|modules)/\d+|
        /meetings|
        /admin(?:
          /(?:students(?:/\d+)?|submissions/\d+|help-requests/\d+|interventions/\d+)|
          /cohorts(?:/[1-9]\d*(?:/settings|/watch-progress|/modules/\d+/grading|/students/\d+/(?:overview|work|learning|support|communication|access))?)?|
          /(?:grading|support|content|team|meetings)
        )?
      )\z}x

      before_action :authenticate_user!

      def create
        destination = params[:destination].to_s
        destination_path = destination.split(/[?#]/, 2).first
        exact_recording = destination.match?(%r{\A/recordings\?cohort_id=[1-9]\d*&recording=(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)\z})
        unless (ALLOWED_DESTINATIONS.match?(destination_path) || exact_recording) && valid_meeting_destination?(destination, destination_path)
          render json: { error: "Unsupported web destination" }, status: :unprocessable_entity
          return
        end
        if destination_path.start_with?("/admin") && !current_user.staff?
          render_forbidden("Staff access is required for this destination")
          return
        end

        redirect_url = "#{FrontendUrlResolver.resolve.delete_suffix('/')}#{destination}"
        result = ClerkWebHandoffService.new.create(user: current_user, redirect_url: redirect_url)
        if result[:success]
          render json: { url: result[:url] }
        else
          render json: { error: result[:error] }, status: :service_unavailable
        end
      end

      private

      def valid_meeting_destination?(destination, pathname)
        return true unless pathname == "/admin/meetings"
        return false if destination.include?("#") || destination.count("?") > 1
        return true unless destination.include?("?")

        pairs = URI.decode_www_form(destination.partition("?").last)
        pairs.any? && pairs.map(&:first).uniq.length == pairs.length && pairs.all? { |key, value| %w[cohort_id booking_id week].include?(key) && value.match?(/\A[1-9]\d*\z/) }
      rescue ArgumentError
        false
      end
    end
  end
end
