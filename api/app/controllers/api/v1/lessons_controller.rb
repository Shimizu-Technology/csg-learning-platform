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
        lessons = @module.lessons.includes(:curriculum_module, :content_blocks)
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
            .order(created_at: :desc)
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
        # Keep the exercise-creation path aligned with the rest of the S3 video
        # entry points: if staff attach an S3-backed intro/demo video while
        # creating the exercise, validate the stored MIME metadata before it
        # reaches the DB rather than accepting arbitrary strings.
        s3_video_content_type = if params[:s3_video_content_type].present?
          validated_video_content_type(params[:s3_video_content_type])
        end
        return if performed?

        ActiveRecord::Base.transaction do
          position = @module.lessons.where(release_day: params[:release_day].to_i).maximum(:position).to_i + 1
          submission_type = normalized_submission_type_for_create
          requires_submission = submission_type != "manual_complete"

          @lesson = @module.lessons.create!(
            title: params[:title],
            lesson_type: :exercise,
            position: position,
            release_day: params[:release_day].to_i,
            required: true,
            requires_submission: requires_submission
          )

          block_pos = 0

          if params[:video_url].present? || params[:s3_video_key].present?
            block_pos += 1
            @lesson.content_blocks.create!(
              block_type: :video,
              position: block_pos,
              title: params[:title],
              video_url: params[:video_url].presence,
              s3_video_key: params[:s3_video_key].presence,
              s3_video_content_type: s3_video_content_type,
              s3_video_size: params[:s3_video_size].presence,
              s3_video_uploaded_by: params[:s3_video_key].present? ? current_user : nil,
              s3_video_uploaded_at: params[:s3_video_key].present? ? Time.current : nil
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
              filename: params[:filename],
              submission_type: submission_type,
              submission_config: submission_config_param
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
          .includes(:module_assignments, cohort: :cohort_module_schedules)
          .find_by(cohorts: { curriculum_id: @lesson.curriculum_module.curriculum_id })

        unless enrollment
          render_forbidden("Cannot access this lesson")
          return
        end

        assignment = enrollment.module_assignments.find_by(module_id: @lesson.module_id)
        lesson_assignment = enrollment.lesson_assignments.find_by(lesson_id: @lesson.id)

        unless assignment&.accessible?(enrollment.cohort) || lesson_assignment.present?
          render_forbidden("Cannot access this lesson")
          return
        end

        return if @lesson.available?(enrollment.cohort, assignment, lesson_assignment)

        render_forbidden("Lesson is not unlocked yet")
      end

      def lesson_json(lesson, include_content: false, progress_map: {}, submission_map: {})
        requires_github = false
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

        if current_user.student?
          enrollment = current_user.enrollments.active
            .joins(:cohort)
            .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
          if enrollment
            cohort = enrollment.cohort
            mod_gh = (cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
            requires_github = mod_gh["requires_github"] || false
            json[:requires_github] = requires_github
            json[:repository_name] = mod_gh["repository_name"].presence || cohort.repository_name
          end
        end

        json[:requires_submission] = lesson.effective_requires_submission(requires_github: requires_github)
        json[:submission_type] = lesson.effective_submission_type(requires_github: requires_github)

        if include_content
          json[:content_blocks] = lesson.content_blocks.map { |cb|
            block = {
              id: cb.id,
              block_type: cb.block_type,
              position: cb.position,
              title: cb.title,
              body: cb.body,
              video_url: cb.video_url,
              s3_video_key: cb.s3_video_key,
              filename: cb.filename,
              submission_type: cb.effective_submission_type(requires_github: requires_github),
              submission_type_explicit: cb.submission_type,
              submission_config: cb.submission_config || {},
              metadata: cb.metadata,
              has_s3_video: cb.s3_video_key.present?
            }

            if current_user.staff?
              block[:s3_video_content_type] = cb.s3_video_content_type
              block[:s3_video_size] = cb.s3_video_size
              block[:s3_video_uploaded_at] = cb.s3_video_uploaded_at
              block[:s3_video_uploaded_by] = cb.s3_video_uploaded_by&.full_name
            end

            # Include solution only for staff
            block[:solution] = cb.solution if current_user.staff?

            # Include progress for students
            if progress_map[cb.id]
              p = progress_map[cb.id]
              block[:progress] = {
                status: p.status,
                completed_at: p.completed_at,
                video_last_position: p.video_last_position,
                video_total_watched: p.video_total_watched
              }
            end

            # Include submissions for students
            if submission_map[cb.id]
              block[:submissions] = submission_map[cb.id].map { |s|
                {
                  id: s.id,
                  submission_type: s.submission_type.presence || cb.effective_submission_type(requires_github: requires_github),
                  text: s.text,
                  grade: s.grade,
                  feedback: s.feedback,
                  graded_at: s.graded_at,
                  github_issue_url: s.github_issue_url,
                  github_code_url: s.github_code_url,
                  repo_url: s.repo_url,
                  pr_url: s.pr_url,
                  live_url: s.live_url,
                  branch: s.branch,
                  commit_sha: s.commit_sha,
                  notes: s.notes,
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

      def normalized_submission_type_for_create
        requested = params[:submission_type].to_s.presence
        return requested if ContentBlock.submission_types.key?(requested)

        ActiveModel::Type::Boolean.new.cast(params[:requires_submission]) ? "text_submission" : "manual_complete"
      end

      def submission_config_param
        return {} unless params[:submission_config].is_a?(ActionController::Parameters)

        params[:submission_config].to_unsafe_h
      end
    end
  end
end
