module Api
  module V1
    class ResourcesController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/resources
      def index
        enrollment = current_user.enrollments.active.includes(:cohort).first

        unless enrollment
          render json: { resources: [] }
          return
        end

        cohort = enrollment.cohort
        resources = Array((cohort.settings || {})["class_resources"])

        render json: {
          resources: resources.map.with_index { |r, i|
            {
              id: i + 1,
              title: r["title"],
              url: r["url"],
              category: r["category"] || "general",
              description: r["description"]
            }
          }
        }
      end
    end
  end
end
