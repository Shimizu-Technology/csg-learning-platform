module Api
  module V1
    class ResourcesController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/resources
      def index
        cohorts = if current_user.staff?
          current_user.accessible_cohorts.where(status: %i[active upcoming]).order(start_date: :desc)
        else
          current_user.accessible_cohorts.order(start_date: :desc)
        end
        if params[:cohort_id].present?
          unless current_user.accessible_cohorts.exists?(id: params[:cohort_id])
            render_forbidden("Cannot access this cohort")
            return
          end
          cohorts = cohorts.respond_to?(:where) ? cohorts.where(id: params[:cohort_id]) : cohorts.select { |cohort| cohort.id.to_s == params[:cohort_id].to_s }
        end
        if cohorts.empty?
          render json: { resources: [] }
          return
        end

        render json: {
          resources: cohorts.flat_map do |cohort|
            links = Array((cohort.settings || {})["class_resources"]).map.with_index do |resource, index|
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
            files_allowed = params[:include_course_files] == "true" && (current_user.staff? || current_user.enrollments.active.exists?(cohort_id: cohort.id))
            files = files_allowed ? cohort.curriculum.curriculum_resources.ready.order(:id).map { |resource| resource.resource_json.merge(cohort_id: cohort.id, cohort_name: cohort.name) } : []
            links + files
          end
        }
      end
    end
  end
end
