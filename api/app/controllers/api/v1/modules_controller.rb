module Api
  module V1
    class ModulesController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, only: [ :create, :update, :destroy ]
      before_action :set_curriculum, only: [ :index, :create ]
      before_action :set_module, only: [ :show, :update, :destroy ]
      before_action :authorize_module_read!, only: [ :show ]

      # GET /api/v1/curricula/:curriculum_id/modules
      def index
        modules = @curriculum.modules.includes(lessons: :content_blocks)
        render json: {
          modules: modules.map { |m| module_json(m) }
        }
      end

      # GET /api/v1/modules/:id
      def show
        render json: {
          module: module_json(@module, include_lessons: true, include_solutions: current_user.staff?)
        }
      end

      # POST /api/v1/curricula/:curriculum_id/modules
      def create
        mod = @curriculum.modules.new(module_params)
        if mod.save
          render json: { module: module_json(mod) }, status: :created
        else
          render json: { errors: mod.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/modules/:id
      def update
        if @module.update(module_params)
          render json: { module: module_json(@module) }
        else
          render json: { errors: @module.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/modules/:id
      def destroy
        @module.destroy
        head :no_content
      end

      private

      def set_curriculum
        @curriculum = Curriculum.find(params[:curricula_id] || params[:curriculum_id])
      end

      def set_module
        @module = CurriculumModule.find(params[:id])
      end

      def module_params
        params.permit(:name, :module_type, :description, :position, :total_days, :day_offset)
      end

      def authorize_module_read!
        return if current_user.staff?

        enrollment = active_enrollment_for_curriculum(@module.curriculum_id)
        unless enrollment
          render_forbidden("Cannot access this module")
          return
        end

        assignment = enrollment.module_assignments.find_by(module_id: @module.id)
        lesson_assignments = enrollment.lesson_assignments.where(lesson_id: @module.lessons.select(:id)).index_by(&:lesson_id)

        unless assignment&.unlocked? || lesson_assignments.any?
          render_forbidden("Cannot access this module")
          return
        end

        return if @module.lessons.empty?
        return if @module.lessons.any? { |lesson| lesson.available?(enrollment.cohort, assignment, lesson_assignments[lesson.id]) }

        render_forbidden("Module is not unlocked yet")
      end

      def active_enrollment_for_curriculum(curriculum_id)
        current_user.enrollments
          .active
          .joins(:cohort)
          .includes(:cohort, :module_assignments)
          .find_by(cohorts: { curriculum_id: curriculum_id })
      end

      def module_json(mod, include_lessons: false, include_solutions: false)
        json = {
          id: mod.id,
          curriculum_id: mod.curriculum_id,
          name: mod.name,
          module_type: mod.module_type,
          description: mod.description,
          position: mod.position,
          total_days: mod.total_days,
          day_offset: mod.day_offset,
          lessons_count: mod.lessons.size
        }

        if include_lessons
          json[:lessons] = mod.lessons.includes(:content_blocks).map { |l|
            {
              id: l.id,
              title: l.title,
              lesson_type: l.lesson_type,
              position: l.position,
              release_day: l.release_day,
              required: l.required,
              content_blocks: l.content_blocks.map { |cb|
                {
                  id: cb.id,
                  block_type: cb.block_type,
                  position: cb.position,
                  title: cb.title,
                  body: cb.body,
                  video_url: cb.video_url,
                  filename: cb.filename,
                  metadata: cb.metadata
                }.tap { |block| block[:solution] = cb.solution if include_solutions }
              }
            }
          }
        end

        json
      end
    end
  end
end
