module Api
  module V1
    class CohortsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_cohort, only: [:show, :update, :destroy]

      # GET /api/v1/cohorts
      def index
        cohorts = Cohort.includes(:curriculum).order(start_date: :desc)
        render json: {
          cohorts: cohorts.map { |c| cohort_json(c) }
        }
      end

      # GET /api/v1/cohorts/:id
      def show
        render json: {
          cohort: cohort_json(@cohort, include_students: true)
        }
      end

      # POST /api/v1/cohorts
      def create
        cohort = Cohort.new(cohort_params)
        if cohort.save
          render json: { cohort: cohort_json(cohort) }, status: :created
        else
          render json: { errors: cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:id
      def update
        if @cohort.update(cohort_params)
          render json: { cohort: cohort_json(@cohort) }
        else
          render json: { errors: @cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/cohorts/:id
      def destroy
        @cohort.destroy
        head :no_content
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:id])
      end

      def cohort_params
        params.permit(:name, :cohort_type, :curriculum_id, :start_date, :end_date,
                       :github_organization_name, :repository_name, :requires_github, :status, :settings)
      end

      def cohort_json(cohort, include_students: false)
        json = {
          id: cohort.id,
          name: cohort.name,
          cohort_type: cohort.cohort_type,
          curriculum_id: cohort.curriculum_id,
          curriculum_name: cohort.curriculum.name,
          start_date: cohort.start_date,
          end_date: cohort.end_date,
          github_organization_name: cohort.github_organization_name,
          repository_name: cohort.repository_name,
          requires_github: cohort.requires_github,
          status: cohort.status,
          settings: cohort.settings,
          enrolled_count: cohort.enrollments.count,
          active_count: cohort.enrollments.active.count
        }

        if include_students
          json[:students] = cohort.enrollments.includes(:user).map { |e|
            {
              enrollment_id: e.id,
              user_id: e.user.id,
              full_name: e.user.full_name,
              email: e.user.email,
              github_username: e.user.github_username,
              status: e.status,
              enrolled_at: e.enrolled_at,
              last_sign_in_at: e.user.last_sign_in_at
            }
          }
        end

        json
      end
    end
  end
end
