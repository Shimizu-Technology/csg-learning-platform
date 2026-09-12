module Api
  module V1
    class CurriculaController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :show ]
      before_action :require_admin!, only: [ :create, :update, :destroy ]
      before_action :set_curriculum, only: [ :show, :update, :destroy ]

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
        @curriculum.with_lock do
          require_current_resource_version!(@curriculum)
          @curriculum.update!(curriculum_params)
        end
        render json: { curriculum: curriculum_json(@curriculum) }
      rescue ActiveRecord::StaleObjectError
        render_stale_resource("Curriculum")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # DELETE /api/v1/curricula/:id
      def destroy
        if @curriculum.destroy
          head :no_content
        else
          render json: { errors: @curriculum.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotDestroyed => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
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
          updated_at: curriculum.updated_at.iso8601(6),
          modules_count: curriculum.modules.size
        }

        if include_modules
          json[:modules] = curriculum.modules.includes(all_lessons: :content_blocks).map { |m|
            lessons = m.all_lessons
            {
              id: m.id,
              curriculum_id: m.curriculum_id,
              name: m.name,
              module_type: m.module_type,
              description: m.description,
              position: m.position,
              total_days: m.total_days,
              day_offset: m.day_offset,
              schedule_days: m.schedule_days,
              updated_at: m.updated_at.iso8601(6),
              scheduled_day_names: m.scheduled_day_names,
              week_count: m.week_count,
              lessons_count: lessons.count { |lesson| !lesson.archived? },
              archived_lessons_count: lessons.count(&:archived?),
              lessons: lessons.map { |l|
                exercise_block = l.content_blocks.find(&:exercise_like?)
                {
                  id: l.id,
                  title: l.title,
                  lesson_type: l.lesson_type,
                  position: l.position,
                  release_day: l.release_day,
                  required: l.required,
                  archived_at: l.archived_at,
                  updated_at: l.updated_at.iso8601(6),
                  requires_submission: exercise_block ? exercise_block.review_required? : l.requires_submission,
                  submission_type: exercise_block&.effective_submission_type || "manual_complete",
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
