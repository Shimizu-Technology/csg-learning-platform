module Api
  module V1
    class ResourcesController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/resources
      def index
        cohorts = if current_user.staff?
          Cohort.where(status: %i[active upcoming]).order(start_date: :desc)
        else
          current_user.enrollments.active.includes(:cohort).limit(1).map(&:cohort)
        end
        if cohorts.empty?
          render json: { resources: [] }
          return
        end

        render json: {
          resources: cohorts.flat_map do |cohort|
            Array((cohort.settings || {})["class_resources"]).map.with_index do |resource, index|
              {
                id: current_user.staff? ? "cohort-#{cohort.id}-#{index + 1}" : index + 1,
                title: resource["title"],
                url: resource["url"],
                category: resource["category"] || "general",
                description: resource["description"],
                cohort_id: cohort.id,
                cohort_name: cohort.name
              }
            end
          end
        }
      end
    end
  end
end
