module Api
  module V1
    class LessonAssignmentsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_enrollment, only: [ :index, :create ]
      before_action :set_lesson_assignment, only: [ :show, :update, :destroy ]

      def index
        assignments = @enrollment.lesson_assignments.includes(:lesson)
        render json: {
          lesson_assignments: assignments.map { |assignment| lesson_assignment_json(assignment) }
        }
      end

      def show
        render json: { lesson_assignment: lesson_assignment_json(@lesson_assignment) }
      end

      def create
        assignment = @enrollment.lesson_assignments.new(lesson_assignment_params)

        if assignment.save
          render json: { lesson_assignment: lesson_assignment_json(assignment) }, status: :created
        else
          render json: { errors: assignment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @lesson_assignment.update(lesson_assignment_params)
          render json: { lesson_assignment: lesson_assignment_json(@lesson_assignment) }
        else
          render json: { errors: @lesson_assignment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @lesson_assignment.destroy
        head :no_content
      end

      private

      def set_enrollment
        @enrollment = Enrollment.find(params[:enrollment_id])
      end

      def set_lesson_assignment
        @lesson_assignment = LessonAssignment.find(params[:id])
      end

      def lesson_assignment_params
        params.permit(:lesson_id, :unlocked, :unlock_date_override)
      end

      def lesson_assignment_json(assignment)
        {
          id: assignment.id,
          enrollment_id: assignment.enrollment_id,
          lesson_id: assignment.lesson_id,
          lesson_title: assignment.lesson.title,
          unlocked: assignment.unlocked,
          unlock_date_override: assignment.unlock_date_override,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at
        }
      end
    end
  end
end
