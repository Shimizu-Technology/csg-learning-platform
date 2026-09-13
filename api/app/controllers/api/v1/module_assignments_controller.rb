module Api
  module V1
    class ModuleAssignmentsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_enrollment, only: [ :index, :create ]
      before_action :set_module_assignment, only: [ :show, :update, :destroy ]

      # GET /api/v1/enrollments/:enrollment_id/module_assignments
      def index
        assignments = @enrollment.module_assignments.includes(:curriculum_module)
        render json: {
          module_assignments: assignments.map { |assignment| module_assignment_json(assignment) }
        }
      end

      # GET /api/v1/module_assignments/:id
      def show
        render json: { module_assignment: module_assignment_json(@module_assignment) }
      end

      # POST /api/v1/enrollments/:enrollment_id/module_assignments
      def create
        with_learning_write_guard(@enrollment) do
          assignment = @enrollment.module_assignments.find_or_initialize_by(module_id: module_assignment_params[:module_id])
          assignment.assign_attributes(normalized_assignment_params(@enrollment))

          if assignment.save
            render json: { module_assignment: module_assignment_json(assignment) }, status: :created
          else
            render json: { errors: assignment.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      # PATCH /api/v1/module_assignments/:id
      def update
        with_learning_write_guard(@module_assignment.enrollment) do
          if @module_assignment.update(normalized_assignment_params(@module_assignment.enrollment))
            render json: { module_assignment: module_assignment_json(@module_assignment) }
          else
            render json: { errors: @module_assignment.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      # DELETE /api/v1/module_assignments/:id
      def destroy
        if @module_assignment.enrollment.cohort.alumni?
          render json: { errors: [ "Alumni enrollments always include every curriculum module" ] }, status: :unprocessable_entity
          return
        end

        with_learning_write_guard(@module_assignment.enrollment) do
          @module_assignment.destroy
          head :no_content
        end
      end

      private

      def set_enrollment
        @enrollment = Enrollment.find(params[:enrollment_id])
      end

      def set_module_assignment
        @module_assignment = ModuleAssignment.find(params[:id])
      end

      def module_assignment_params
        params.permit(:module_id, :unlocked, :unlock_date_override)
      end

      def normalized_assignment_params(enrollment)
        permitted = module_assignment_params
        return permitted unless enrollment.cohort.alumni?

        permitted.merge(unlocked: true, unlock_date_override: nil)
      end

      def module_assignment_json(assignment)
        {
          id: assignment.id,
          enrollment_id: assignment.enrollment_id,
          module_id: assignment.module_id,
          module_name: assignment.curriculum_module.name,
          module_type: assignment.curriculum_module.module_type,
          unlocked: assignment.unlocked,
          unlock_date_override: assignment.unlock_date_override,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at
        }
      end
    end
  end
end
