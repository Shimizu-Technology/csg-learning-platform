module Api
  module V1
    class CurriculaController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, only: [:create, :update, :destroy]
      before_action :set_curriculum, only: [:show, :update, :destroy]

      # GET /api/v1/curricula
      def index
        curricula = Curriculum.all.order(:name)
        render json: {
          curricula: curricula.map { |c| curriculum_json(c) }
        }
      end

      # GET /api/v1/curricula/:id
      def show
        render json: {
          curriculum: curriculum_json(@curriculum, include_modules: true)
        }
      end

      # POST /api/v1/curricula
      def create
        curriculum = Curriculum.new(curriculum_params)
        if curriculum.save
          render json: { curriculum: curriculum_json(curriculum) }, status: :created
        else
          render json: { errors: curriculum.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/curricula/:id
      def update
        if @curriculum.update(curriculum_params)
          render json: { curriculum: curriculum_json(@curriculum) }
        else
          render json: { errors: @curriculum.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/curricula/:id
      def destroy
        if @curriculum.destroy
          head :no_content
        else
          render json: { errors: @curriculum.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_curriculum
        @curriculum = Curriculum.find(params[:id])
      end

      def curriculum_params
        params.permit(:name, :description, :total_weeks, :status)
      end

      def curriculum_json(curriculum, include_modules: false)
        json = {
          id: curriculum.id,
          name: curriculum.name,
          description: curriculum.description,
          total_weeks: curriculum.total_weeks,
          status: curriculum.status,
          modules_count: curriculum.modules.size
        }

        if include_modules
          json[:modules] = curriculum.modules.includes(lessons: :content_blocks).map { |m|
            {
              id: m.id,
              name: m.name,
              module_type: m.module_type,
              description: m.description,
              position: m.position,
              total_days: m.total_days,
              day_offset: m.day_offset,
              lessons_count: m.lessons.size,
              lessons: m.lessons.map { |l|
                {
                  id: l.id,
                  title: l.title,
                  lesson_type: l.lesson_type,
                  position: l.position,
                  release_day: l.release_day,
                  required: l.required,
                  content_blocks_count: l.content_blocks.size
                }
              }
            }
          }
        end

        json
      end
    end
  end
end
