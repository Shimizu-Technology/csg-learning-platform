module Api
  module V1
    class LessonsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, only: [ :create, :create_exercise, :update, :destroy ]
      before_action :set_module, only: [ :index, :create, :create_exercise ]
      before_action :set_lesson, only: [ :show, :update, :destroy ]
      before_action :authorize_lesson_read!, only: [ :show ]

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

      # POST /api/v1/modules/:module_id/exercises
      def create_exercise
        ActiveRecord::Base.transaction do
          position = @module.lessons.where(release_day: params[:release_day].to_i).maximum(:position).to_i + 1

          @lesson = @module.lessons.create!(
            title: params[:title],
            lesson_type: :exercise,
            position: position,
            release_day: params[:release_day].to_i,
            required: true,
            requires_submission: ActiveModel::Type::Boolean.new.cast(params[:requires_submission])
          )

          block_pos = 0

          if params[:video_url].present?
            block_pos += 1
            @lesson.content_blocks.create!(
              block_type: :video,
              position: block_pos,
              title: params[:title],
              video_url: params[:video_url]
            )
          end

          if params[:instructions].present? || params[:filename].present?
            block_pos += 1
            @lesson.content_blocks.create!(
              block_type: :exercise,
              position: block_pos,
              title: params[:title],
              body: params[:instructions],
              solution: params[:solution],
              filename: params[:filename]
            )
          end

          render json: { lesson: lesson_json(@lesson) }, status: :created
        end
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
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
        params.permit(:title, :lesson_type, :position, :release_day, :required, :requires_submission)
      end

      def authorize_lesson_read!
        return if current_user.staff?

        enrollment = current_user.enrollments
          .active
          .joins(:cohort)
          .includes(:cohort, :module_assignments)
          .find_by(cohorts: { curriculum_id: @lesson.curriculum_module.curriculum_id })

        unless enrollment
          render_forbidden("Cannot access this lesson")
          return
        end

        assignment = enrollment.module_assignments.find_by(module_id: @lesson.module_id)
        lesson_assignment = enrollment.lesson_assignments.find_by(lesson_id: @lesson.id)

        unless assignment&.accessible? || lesson_assignment.present?
          render_forbidden("Cannot access this lesson")
          return
        end

        return if @lesson.available?(enrollment.cohort, assignment, lesson_assignment)

        render_forbidden("Lesson is not unlocked yet")
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
          requires_submission: lesson.requires_submission,
          content_blocks_count: lesson.content_blocks.size
        }

        if current_user.student?
          enrollment = current_user.enrollments.active
            .joins(:cohort)
            .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
          if enrollment
            cohort = enrollment.cohort
            mod_gh = (cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
            json[:requires_github] = mod_gh["requires_github"] || false
            json[:repository_name] = mod_gh["repository_name"].presence || cohort.repository_name
          end
        end

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

          sibling_lessons = Lesson.where(module_id: lesson.module_id).order(:position).to_a
          current_index = sibling_lessons.index { |l| l.id == lesson.id }

          if current_index && !current_user.staff?
            enrollment = current_user.enrollments.active
              .joins(:cohort)
              .includes(:cohort, :module_assignments, :lesson_assignments)
              .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
            if enrollment
              ma = enrollment.module_assignments.find_by(module_id: lesson.module_id)
              available_siblings = sibling_lessons.select { |l|
                la = enrollment.lesson_assignments.find_by(lesson_id: l.id)
                l.available?(enrollment.cohort, ma, la)
              }
              avail_index = available_siblings.index { |l| l.id == lesson.id }
              prev_lesson = avail_index && avail_index > 0 ? available_siblings[avail_index - 1] : nil
              next_lesson = avail_index && avail_index < available_siblings.size - 1 ? available_siblings[avail_index + 1] : nil
            else
              prev_lesson = nil
              next_lesson = nil
            end
          elsif current_index
            prev_lesson = current_index > 0 ? sibling_lessons[current_index - 1] : nil
            next_lesson = current_index < sibling_lessons.size - 1 ? sibling_lessons[current_index + 1] : nil
          end

          if current_index
            json[:prev_lesson] = prev_lesson ? { id: prev_lesson.id, title: prev_lesson.title } : nil
            json[:next_lesson] = next_lesson ? { id: next_lesson.id, title: next_lesson.title } : nil
          end
        end

        json
      end
    end
  end
end
