module Api
  module V1
    class ObjectiveAlignmentsController < ApplicationController
      MAX_ALIGNMENTS = 50

      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_lesson

      def update
        requested = alignment_params
        if requested.length > MAX_ALIGNMENTS
          render json: { errors: [ "A lesson can have at most #{MAX_ALIGNMENTS} objective alignments" ] }, status: :unprocessable_entity
          return
        end

        ObjectiveAlignment.transaction do
          @lesson.objective_alignments.destroy_all
          requested.each_with_index do |alignment, position|
            objective = LearningObjective.find(alignment.fetch(:learning_objective_id))
            content_block = alignment[:content_block_id].present? ? @lesson.content_blocks.find(alignment[:content_block_id]) : nil
            @lesson.objective_alignments.create!(
              learning_objective: objective,
              lesson: @lesson,
              content_block: content_block,
              position: position
            )
          end
        end

        render json: { objectives: objective_json }
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound, KeyError => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end

      private

      def set_lesson
        @lesson = Lesson.find(params[:lesson_id])
      end

      def alignment_params
        raw = params[:alignments]
        return [] if raw.blank?

        params.require(:alignments).map { |alignment| alignment.permit(:learning_objective_id, :content_block_id).to_h.symbolize_keys }
      end

      def objective_json
        @lesson.objective_alignments.includes(:learning_objective, :content_block).ordered.map do |alignment|
          objective = alignment.learning_objective
          {
            alignment_id: alignment.id,
            id: objective.id,
            code: objective.code,
            title: objective.title,
            description: objective.description,
            success_criteria: objective.success_criteria,
            active: objective.active,
            content_block_id: alignment.content_block_id,
            content_block_title: alignment.content_block&.title
          }
        end
      end
    end
  end
end
