module Api
  module V1
    class KnowledgeCheckAttemptsController < ApplicationController
      before_action :authenticate_user!

      def create
        unless current_user.student?
          render_forbidden("Only students can record retrieval-check evidence")
          return
        end

        knowledge_check = KnowledgeCheck.find(params[:knowledge_check_id])
        authorize_content_block_write!(knowledge_check.content_block)
        return if performed?

        selected_option = Integer(params.require(:selected_option))
        attempt = nil
        progress = nil
        with_learning_write_guard(@learning_write_enrollment) do
          KnowledgeCheckAttempt.transaction do
            attempt = knowledge_check.attempts.create!(
              user: current_user,
              selected_option: selected_option,
              correct: knowledge_check.correct_option?(selected_option)
            )
            if attempt.correct?
              progress = current_user.progresses.find_or_initialize_by(content_block: knowledge_check.content_block)
              progress.update!(status: :completed)
            end
          end
        end

        render json: {
          knowledge_check: knowledge_check_json(knowledge_check, attempt),
          progress: progress ? { status: progress.status, completed_at: progress.completed_at } : nil
        }, status: :created
      rescue ArgumentError, ActionController::ParameterMissing => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def knowledge_check_json(check, attempt)
        {
          id: check.id,
          prompt: check.prompt,
          options: check.options,
          objective_code: check.learning_objective&.code,
          attempt_count: check.attempts.where(user: current_user).count,
          latest_attempt: {
            id: attempt.id,
            selected_option: attempt.selected_option,
            correct: attempt.correct,
            correct_option: check.correct_option,
            explanation: check.explanation,
            created_at: attempt.created_at
          }
        }
      end
    end
  end
end
