module Api
  module V1
    class ProgressController < ApplicationController
      before_action :authenticate_user!

      # PATCH /api/v1/progress
      def update
        content_block = ContentBlock.find(params[:content_block_id])

        progress = Progress.find_or_initialize_by(
          user: current_user,
          content_block: content_block
        )

        progress.status = params[:status]

        if progress.save
          render json: {
            progress: {
              id: progress.id,
              content_block_id: progress.content_block_id,
              status: progress.status,
              completed_at: progress.completed_at
            }
          }
        else
          render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # GET /api/v1/progress — get current user's progress for a module or lesson
      def index
        if params[:module_id].present?
          mod = CurriculumModule.find(params[:module_id])
          block_ids = ContentBlock.joins(:lesson).where(lessons: { module_id: mod.id }).pluck(:id)
        elsif params[:lesson_id].present?
          lesson = Lesson.find(params[:lesson_id])
          block_ids = lesson.content_blocks.pluck(:id)
        else
          # All progress for current user
          block_ids = nil
        end

        progresses = current_user.progresses
        progresses = progresses.where(content_block_id: block_ids) if block_ids

        render json: {
          progress: progresses.map { |p|
            {
              id: p.id,
              content_block_id: p.content_block_id,
              status: p.status,
              completed_at: p.completed_at
            }
          }
        }
      end

      # GET /api/v1/progress/student/:user_id — admin: view student progress
      def student
        require_staff!
        return if performed?

        user = User.find(params[:user_id])
        progresses = user.progresses.includes(:content_block)

        render json: {
          user_id: user.id,
          user_name: user.full_name,
          progress: progresses.map { |p|
            {
              id: p.id,
              content_block_id: p.content_block_id,
              block_type: p.content_block.block_type,
              status: p.status,
              completed_at: p.completed_at
            }
          }
        }
      end
    end
  end
end
