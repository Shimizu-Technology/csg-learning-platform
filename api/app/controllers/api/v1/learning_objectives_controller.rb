module Api
  module V1
    class LearningObjectivesController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_objective, only: [ :update, :destroy ]

      def index
        curriculum = Curriculum.find(params.require(:curriculum_id))
        render json: { learning_objectives: curriculum.learning_objectives.includes(:objective_alignments).ordered.map { |objective| objective_json(objective) } }
      end

      def create
        objective = LearningObjective.new(objective_params)
        if objective.save
          render json: { learning_objective: objective_json(objective) }, status: :created
        else
          render json: { errors: objective.errors.full_messages }, status: :unprocessable_entity
        end
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
