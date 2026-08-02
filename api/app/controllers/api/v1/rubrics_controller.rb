module Api
  module V1
    class RubricsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_rubric, only: [ :update, :destroy ]

      def index
        curriculum = Curriculum.find(params.require(:curriculum_id))
        render json: { rubrics: curriculum.rubrics.includes(rubric_criteria: :learning_objective).ordered.map { |rubric| rubric_json(rubric) } }
      end

      def create
        rubric = nil
        Rubric.transaction do
          rubric = Rubric.new(rubric_params.except(:criteria))
          criteria_params.each_with_index do |criterion, position|
            rubric.rubric_criteria.build(criterion.merge(position: position))
          end
          rubric.save!
        end
        render json: { rubric: rubric_json(rubric) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def update
        if @rubric.update(rubric_params.except(:criteria, :curriculum_id))
          render json: { rubric: rubric_json(@rubric) }
        else
          render json: { errors: @rubric.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        if @rubric.destroy
          head :no_content
        else
          render json: { errors: @rubric.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_rubric
        @rubric = Rubric.find(params[:id])
      end

      def rubric_params
        params.require(:rubric).permit(:curriculum_id, :title, :description, :active, criteria: [ :title, :description, :learning_objective_id ])
      end

      def criteria_params
        rubric_params[:criteria] || []
      end

      def rubric_json(rubric)
        {
          id: rubric.id,
          curriculum_id: rubric.curriculum_id,
          title: rubric.title,
          description: rubric.description,
          active: rubric.active,
          criteria: rubric.rubric_criteria.ordered.map do |criterion|
            {
              id: criterion.id,
              title: criterion.title,
              description: criterion.description,
              position: criterion.position,
              learning_objective_id: criterion.learning_objective_id,
              objective_code: criterion.learning_objective&.code
            }
          end
        }
      end
    end
  end
end
