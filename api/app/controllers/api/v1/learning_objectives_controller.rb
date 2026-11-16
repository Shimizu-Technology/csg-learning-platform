module Api
  module V1
    class LearningObjectivesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      include LessonEditAuthorization
      # Instructors with editing access to a curriculum can add to it from the
      # lesson editor; changing or deleting shared items stays admin-only.
      before_action :require_admin!, except: [ :index, :create ]
      # One require_staff! declaration: a second one would replace this one.
      before_action :require_staff!, only: [ :index, :create ]
      before_action -> { require_lesson_edit_access!(Curriculum.find(params.dig(:learning_objective, :curriculum_id))) }, only: [ :create ]
      before_action :set_objective, only: [ :update, :destroy ]

      def index
        curriculum = Curriculum.find(params.require(:curriculum_id))
        render json: { learning_objectives: curriculum.learning_objectives.includes(:objective_alignments).ordered.map { |objective| objective_json(objective) } }
      end

      def create
        objective = nil
        curriculum = Curriculum.find(objective_params[:curriculum_id])
        lesson = Lesson.find(params[:lesson_id]) if params[:lesson_id].present?
        LearningObjective.transaction do
          # Re-check under the curriculum and grant locks (LessonEditAccess),
          # so a revoke or a newly shared curriculum can't slip in before the
          # commit.
          recheck_lesson_edit_access!(curriculum)
          objective = LearningObjective.create!(objective_params)
          if lesson
            unless lesson.curriculum_module.curriculum_id == objective.curriculum_id
              objective.errors.add(:curriculum, "must match the lesson curriculum")
              raise ActiveRecord::RecordInvalid, objective
            end
            # Aligning changes the lesson: take its authoring lock, which also
            # advances its version so an open editor sees the change.
            lesson.with_authoring_lock do
              lesson.objective_alignments.create!(
                learning_objective: objective,
                position: lesson.objective_alignments.maximum(:position).to_i + 1
              )
            end
          end
        end
        render json: { learning_objective: objective_json(objective) }, status: :created
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound => error
        messages = error.respond_to?(:record) ? error.record.errors.full_messages : [ error.message ]
        render json: { errors: messages }, status: :unprocessable_entity
      end

      def update
        if @objective.update(objective_params.except(:curriculum_id))
          render json: { learning_objective: objective_json(@objective) }
        else
          render json: { errors: @objective.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        if @objective.destroy
          head :no_content
        else
          render json: { errors: @objective.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_objective
        @objective = LearningObjective.find(params[:id])
      end

      def objective_params
        params.require(:learning_objective).permit(:curriculum_id, :code, :title, :description, :success_criteria, :position, :active)
      end

      def objective_json(objective)
        {
          id: objective.id,
          curriculum_id: objective.curriculum_id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          success_criteria: objective.success_criteria,
          position: objective.position,
          active: objective.active,
          alignment_count: objective.objective_alignments.size
        }
      end
    end
  end
end
