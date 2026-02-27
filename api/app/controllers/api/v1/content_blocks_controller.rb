module Api
  module V1
    class ContentBlocksController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_lesson, only: [:index, :create]
      before_action :set_content_block, only: [:show, :update, :destroy]

      # GET /api/v1/lessons/:lesson_id/content_blocks
      def index
        blocks = @lesson.content_blocks
        render json: { content_blocks: blocks.map { |cb| block_json(cb) } }
      end

      # GET /api/v1/content_blocks/:id
      def show
        render json: { content_block: block_json(@content_block) }
      end

      # POST /api/v1/lessons/:lesson_id/content_blocks
      def create
        block = @lesson.content_blocks.new(block_params)
        if block.save
          render json: { content_block: block_json(block) }, status: :created
        else
          render json: { errors: block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/content_blocks/:id
      def update
        if @content_block.update(block_params)
          render json: { content_block: block_json(@content_block) }
        else
          render json: { errors: @content_block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/content_blocks/:id
      def destroy
        @content_block.destroy
        head :no_content
      end

      private

      def set_lesson
        @lesson = Lesson.find(params[:lesson_id])
      end

      def set_content_block
        @content_block = ContentBlock.find(params[:id])
      end

      def block_params
        params.permit(:block_type, :position, :title, :body, :video_url, :solution, :filename, :metadata)
      end

      def block_json(cb)
        {
          id: cb.id,
          lesson_id: cb.lesson_id,
          block_type: cb.block_type,
          position: cb.position,
          title: cb.title,
          body: cb.body,
          video_url: cb.video_url,
          solution: cb.solution,
          filename: cb.filename,
          metadata: cb.metadata
        }
      end
    end
  end
end
