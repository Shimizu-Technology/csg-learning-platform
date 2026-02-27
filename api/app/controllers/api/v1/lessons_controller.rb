module Api
  module V1
    class LessonsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, only: [:create, :update, :destroy]
      before_action :set_module, only: [:index, :create]
      before_action :set_lesson, only: [:show, :update, :destroy]

      # GET /api/v1/modules/:module_id/lessons
      def index
        lessons = @module.lessons.includes(:content_blocks)
        render json: {
          lessons: lessons.map { |l| lesson_json(l) }
        }
      end

      # GET /api/v1/lessons/:id
      def show
        # Include user progress if student
        progress_map = {}
        submission_map = {}

        if current_user.student?
          progress_map = current_user.progresses
            .where(content_block_id: @lesson.content_blocks.pluck(:id))
            .index_by(&:content_block_id)

          submission_map = current_user.submissions
            .where(content_block_id: @lesson.content_blocks.pluck(:id))
            .group_by(&:content_block_id)
        end

        render json: {
          lesson: lesson_json(@lesson, include_content: true, progress_map: progress_map, submission_map: submission_map)
        }
      end

      # POST /api/v1/modules/:module_id/lessons
      def create
        lesson = @module.lessons.new(lesson_params)
        if lesson.save
          render json: { lesson: lesson_json(lesson) }, status: :created
        else
          render json: { errors: lesson.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/lessons/:id
      def update
        if @lesson.update(lesson_params)
          render json: { lesson: lesson_json(@lesson) }
        else
          render json: { errors: @lesson.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/lessons/:id
      def destroy
        @lesson.destroy
        head :no_content
      end

      private

      def set_module
        @module = CurriculumModule.find(params[:module_id])
      end

      def set_lesson
        @lesson = Lesson.find(params[:id])
      end

      def lesson_params
        params.permit(:title, :lesson_type, :position, :release_day, :required)
      end

      def lesson_json(lesson, include_content: false, progress_map: {}, submission_map: {})
        json = {
          id: lesson.id,
          module_id: lesson.module_id,
          title: lesson.title,
          lesson_type: lesson.lesson_type,
          position: lesson.position,
          release_day: lesson.release_day,
          required: lesson.required,
          content_blocks_count: lesson.content_blocks.size
        }

        if include_content
          json[:content_blocks] = lesson.content_blocks.map { |cb|
            block = {
              id: cb.id,
              block_type: cb.block_type,
              position: cb.position,
              title: cb.title,
              body: cb.body,
              video_url: cb.video_url,
              filename: cb.filename,
              metadata: cb.metadata
            }

            # Include solution only for staff
            block[:solution] = cb.solution if current_user.staff?

            # Include progress for students
            if progress_map[cb.id]
              block[:progress] = {
                status: progress_map[cb.id].status,
                completed_at: progress_map[cb.id].completed_at
              }
            end

            # Include submissions for students
            if submission_map[cb.id]
              block[:submissions] = submission_map[cb.id].map { |s|
                {
                  id: s.id,
                  text: s.text,
                  grade: s.grade,
                  feedback: s.feedback,
                  graded_at: s.graded_at,
                  num_submissions: s.num_submissions,
                  created_at: s.created_at
                }
              }
            end

            block
          }

          # Get adjacent lessons for navigation
          sibling_lessons = Lesson.unscoped
            .where(module_id: lesson.module_id)
            .order(:position)

          current_index = sibling_lessons.to_a.index { |l| l.id == lesson.id }
          if current_index
            prev_lesson = current_index > 0 ? sibling_lessons[current_index - 1] : nil
            next_lesson = current_index < sibling_lessons.size - 1 ? sibling_lessons[current_index + 1] : nil

            json[:prev_lesson] = prev_lesson ? { id: prev_lesson.id, title: prev_lesson.title } : nil
            json[:next_lesson] = next_lesson ? { id: next_lesson.id, title: next_lesson.title } : nil
          end
        end

        json
      end
    end
  end
end
