module Api
  module V1
    class CohortInstructorAssignmentsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_cohort

      def index
        render json: { instructors: @cohort.instructors.not_archived.order(:first_name, :last_name, :email).map { |user| user_json(user) } }
      end

      def create
        user = User.not_archived.instructor.find(params[:user_id])
        assignment = @cohort.cohort_instructor_assignments.find_or_initialize_by(user: user)
        if assignment.save
          render json: { instructor: user_json(user) }, status: :created
        else
          render json: { errors: assignment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @cohort.cohort_instructor_assignments.find_by!(user_id: params[:id]).destroy!
        head :no_content
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def user_json(user)
        { id: user.id, full_name: user.full_name, email: user.email }
      end
    end
  end
end
