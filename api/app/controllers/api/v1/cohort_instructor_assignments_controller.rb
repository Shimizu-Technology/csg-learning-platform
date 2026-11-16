module Api
  module V1
    class CohortInstructorAssignmentsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!
      before_action :set_cohort

      def index
        assignments = @cohort.cohort_instructor_assignments
          .joins(:user).merge(User.not_archived.instructor)
          .includes(:user, :edit_granted_by)
          .order("users.first_name", "users.last_name", "users.email")
        render json: { instructors: assignments.map { |assignment| instructor_json(assignment) } }
      end

      def create
        user = User.not_archived.instructor.find(params[:user_id])
        assignment = @cohort.cohort_instructor_assignments.find_or_initialize_by(user: user)
        if assignment.save
          render json: { instructor: instructor_json(assignment) }, status: :created
        else
          render json: { errors: assignment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:cohort_id/instructor_assignments/:id/lesson_editing
      # Turns lesson editing on or off for one instructor on this cohort
      # (LessonEditAccess). :id is the instructor's user id, as in destroy.
      def lesson_editing
        unless [ true, false ].include?(params[:can_edit_lessons])
          render json: { error: "can_edit_lessons must be true or false" }, status: :unprocessable_entity
          return
        end

        assignment = @cohort.cohort_instructor_assignments.find_by!(user_id: params[:id])
        assignment.set_lesson_editing!(params[:can_edit_lessons], by: current_user)
        render json: { instructor: instructor_json(assignment.reload) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # Removing an instructor removes their lesson editing access for this
      # cohort with the row; the audit trail records that as a revoke.
      def destroy
        assignment = @cohort.cohort_instructor_assignments.find_by!(user_id: params[:id])
        CohortInstructorAssignment.transaction do
          assignment.lock!
          if assignment.can_edit_lessons
            ActivityEvent.record!(event_type: "lesson_editing_revoked", actor: current_user, subject_user: assignment.user, cohort: @cohort)
          end
          assignment.destroy!
        end
        head :no_content
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def instructor_json(assignment)
        user = assignment.user
        {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          can_edit_lessons: assignment.can_edit_lessons,
          edit_granted_by: assignment.can_edit_lessons && assignment.edit_granted_by ? { id: assignment.edit_granted_by.id, full_name: assignment.edit_granted_by.full_name } : nil,
          edit_granted_at: assignment.can_edit_lessons ? assignment.edit_granted_at&.iso8601 : nil
        }
      end
    end
  end
end
