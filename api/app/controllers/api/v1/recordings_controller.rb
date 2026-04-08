module Api
  module V1
    class RecordingsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/recordings
      def index
        enrollment = current_user.enrollments.active.includes(:cohort).first

        unless enrollment
          render json: { recordings: [] }
          return
        end

        cohort = enrollment.cohort
        recordings = Array((cohort.settings || {})["recordings"])

        render json: {
          recordings: recordings.map.with_index { |r, i|
            {
              id: i + 1,
              title: r["title"],
              url: r["url"],
              date: r["date"],
              description: r["description"]
            }
          }
        }
      end
    end
  end
end
