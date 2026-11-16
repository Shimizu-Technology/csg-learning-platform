module Api
  module V1
    class RubricsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      include LessonEditAuthorization
      # Instructors with editing access to a curriculum can add to it from the
      # lesson editor; changing or deleting shared items stays admin-only.
      before_action :require_admin!, except: [ :index, :create ]
      # One require_staff! declaration: a second one would replace this one.
      before_action :require_staff!, only: [ :index, :create ]
      before_action -> { require_lesson_edit_access!(Curriculum.find(params.dig(:rubric, :curriculum_id))) }, only: [ :create ]
      before_action :set_rubric, only: [ :update, :destroy ]

      def index
        curriculum = Curriculum.find(params.require(:curriculum_id))
        render json: { rubrics: curriculum.rubrics.includes(rubric_criteria: :learning_objective).ordered.map { |rubric| rubric_json(rubric) } }
      end

      def create
        rubric = nil
        Rubric.transaction do
          # Re-check under the curriculum and grant locks (LessonEditAccess).
          recheck_lesson_edit_access!(Curriculum.find(rubric_params[:curriculum_id]))
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
        Rubric.transaction do
          @rubric.assign_attributes(rubric_params.except(:criteria, :curriculum_id))
          replace_criteria! if rubric_params.key?(:criteria)
          @rubric.save!
        end
        render json: { rubric: rubric_json(@rubric.reload) }
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
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
        params.require(:rubric).permit(:curriculum_id, :title, :description, :active, criteria: [ :id, :title, :description, :learning_objective_id ])
      end

      def criteria_params
        rubric_params[:criteria] || []
      end

      def replace_criteria!
        existing = @rubric.rubric_criteria.index_by { |criterion| criterion.id.to_s }
        retained_ids = []

        criteria_params.each_with_index do |attributes, position|
          criterion_id = attributes[:id].presence&.to_s
          criterion = if criterion_id
            existing.fetch(criterion_id) { raise ActiveRecord::RecordNotFound, "Rubric criterion not found" }
          else
            @rubric.rubric_criteria.build
          end
          criterion.update!(attributes.except(:id).merge(position: position))
          retained_ids << criterion.id if criterion.persisted?
        end

        @rubric.rubric_criteria.where.not(id: retained_ids).find_each(&:destroy!)
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
