module Api
  module V1
    class InterventionNotesController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!

      def create
        intervention = Intervention.find(params[:intervention_id])
        note = intervention.notes.create!(author: current_user, body: note_params[:body].to_s.strip)
        render json: { note: InterventionSerializer.note_json(note) }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def note_params
        params.require(:note).permit(:body)
      end
    end
  end
end
