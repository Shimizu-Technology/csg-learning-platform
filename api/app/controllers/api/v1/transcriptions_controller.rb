module Api
  module V1
    class TranscriptionsController < ApplicationController
      SURFACES = %w[message thread help_request grading_feedback].freeze

      before_action :authenticate_user!

      def create
        unless ENV["VOICE_TRANSCRIPTION_ENABLED"] == "true"
          render json: { error: "Voice transcription is not enabled yet." }, status: :service_unavailable
          return
        end
        unless SURFACES.include?(params[:surface])
          render json: { error: "surface must be one of: #{SURFACES.join(', ')}" }, status: :unprocessable_entity
          return
        end
        unless params[:cleanup] == "conservative"
          render json: { error: "cleanup must be conservative" }, status: :unprocessable_entity
          return
        end
        unless params[:audio].is_a?(ActionDispatch::Http::UploadedFile)
          render json: { error: "Choose a voice recording." }, status: :unprocessable_entity
          return
        end
        unless VoiceTranscriptionRateLimiter.allow?(current_user.id)
          response.set_header("Retry-After", VoiceTranscriptionRateLimiter::WINDOW.to_i.to_s)
          render json: { error: "Too many voice requests. Wait a few minutes and try again." }, status: :too_many_requests
          return
        end

        inspection = VoiceAudioInspection.call(params[:audio])
        result = VoiceTranscriptionService.new.call(
          upload: params[:audio],
          duration_seconds: inspection.fetch(:duration_seconds)
        )
        render json: result
      rescue VoiceAudioInspection::InvalidAudio => error
        render json: { error: error.message }, status: :unprocessable_entity
      rescue VoiceTranscriptionService::NotConfigured
        render json: { error: "Voice transcription is not configured." }, status: :service_unavailable
      rescue OpenaiVoiceProvider::ProviderError => error
        render json: { error: error.message }, status: :bad_gateway
      end
    end
  end
end
