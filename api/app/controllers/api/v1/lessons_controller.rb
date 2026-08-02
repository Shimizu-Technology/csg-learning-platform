module Api
  module V1
    class LessonsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, only: [ :create, :create_exercise, :update, :update_editor, :destroy ]
      before_action :set_module, only: [ :index, :create, :create_exercise ]
      before_action :set_lesson, only: [ :show, :update, :update_editor, :destroy ]
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

      # PATCH /api/v1/lessons/:id/editor
      # Saves the exercise editor as one unit so lesson fields, content blocks,
      # and objective alignments cannot drift apart on a partial request failure.
      def update_editor
        old_s3_key = nil
        new_s3_key = nil

        ActiveRecord::Base.transaction do
          @lesson.update!(editor_lesson_params)
          old_s3_key, new_s3_key = update_editor_video!
          update_editor_exercise!
          replace_editor_objective_alignments!
        end

        if old_s3_key.present? && old_s3_key != new_s3_key && S3Service.configured?
          begin
            S3Service.delete_object(old_s3_key)
          rescue StandardError => error
            # The database save has already committed and S3 cleanup cannot be
            # rolled back. Report the save accurately and leave cleanup retryable.
            Rails.logger.error("Failed to delete replaced lesson video #{old_s3_key}: #{error.class}")
          end
        end

        @lesson.reload
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound, KeyError => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
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

      def editor_params
        params.require(:editor).permit(
          :title,
          :requires_submission,
          video: [ :id, :title, :video_url, :s3_video_key ],
          exercise: [ :id, :title, :body, :solution, :filename, :submission_type, { submission_config: {} } ],
          alignments: [ :learning_objective_id, :content_block_id ]
        )
      end

      def editor_lesson_params
        editor_params.slice(:title, :requires_submission)
      end

      def update_editor_video!
        payload = editor_params[:video]
        return [ nil, nil ] if payload.blank?

        block = if payload[:id].present?
          @lesson.content_blocks.where(block_type: %i[video recording]).find(payload[:id])
        else
          return [ nil, nil ] if payload[:video_url].blank? && payload[:s3_video_key].blank?

          @lesson.content_blocks.new(block_type: :video, position: next_editor_block_position)
        end

        old_s3_key = block.s3_video_key
        attributes = payload.slice(:title, :video_url)
        attributes[:s3_video_key] = payload[:s3_video_key] if payload.key?(:s3_video_key)
        block.assign_attributes(attributes)

        if block.s3_video_key != old_s3_key
          block.s3_video_duration_seconds = nil
          if block.s3_video_key.present?
            block.s3_video_uploaded_by = current_user
            block.s3_video_uploaded_at = Time.current
          else
            block.s3_video_uploaded_by = nil
            block.s3_video_uploaded_at = nil
          end
        end
        block.save!

        if old_s3_key.present? && block.s3_video_key != old_s3_key
          block.progresses.update_all(
            video_last_position: 0,
            video_total_watched: 0,
            video_duration: nil,
            status: Progress.statuses[:not_started],
            completed_at: nil,
            updated_at: Time.current
          )
        end

        [ old_s3_key, block.s3_video_key ]
      end

      def update_editor_exercise!
        payload = editor_params[:exercise]
        return if payload.blank?

        block = if payload[:id].present?
          @lesson.content_blocks.where(block_type: %i[exercise code_challenge]).find(payload[:id])
        else
          return if payload[:body].blank? && payload[:filename].blank?

          @lesson.content_blocks.new(block_type: :exercise, position: next_editor_block_position)
        end
        block.update!(payload.except(:id))
      end

      def replace_editor_objective_alignments!
        requested = editor_params[:alignments] || []
        if requested.length > ObjectiveAlignmentsController::MAX_ALIGNMENTS
          @lesson.errors.add(:objectives, "can have at most #{ObjectiveAlignmentsController::MAX_ALIGNMENTS} alignments")
          raise ActiveRecord::RecordInvalid, @lesson
        end

        @lesson.objective_alignments.destroy_all
        requested.each_with_index do |alignment, position|
          objective = LearningObjective.find(alignment.fetch(:learning_objective_id))
          content_block = alignment[:content_block_id].present? ? @lesson.content_blocks.find(alignment[:content_block_id]) : nil
          @lesson.objective_alignments.create!(
            learning_objective: objective,
            content_block: content_block,
            position: position
          )
        end
      end

      def next_editor_block_position
        @lesson.content_blocks.maximum(:position).to_i + 1
      end

      def authorize_lesson_read!
        return if current_user.staff?

        enrollment = current_user.enrollments
          .active
          .joins(:cohort)
          .includes(:module_assignments, cohort: [ :cohort_module_schedules, :cohort_module_submission_windows ])
          .find_by(cohorts: { curriculum_id: @lesson.curriculum_module.curriculum_id })

        unless enrollment
          render_forbidden("Cannot access this lesson")
          return
        end
        @lesson_enrollment = enrollment

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
          curriculum_id: lesson.curriculum_module.curriculum_id,
          module_id: lesson.module_id,
          title: lesson.title,
          lesson_type: lesson.lesson_type,
          position: lesson.position,
          release_day: lesson.release_day,
          required: lesson.required,
          content_blocks_count: lesson.content_blocks.size
        }

        json[:objectives] = objective_json(lesson, include_inactive: current_user.staff?)

        if current_user.student?
          enrollment = @lesson_enrollment || current_user.enrollments.active
            .joins(:cohort)
            .includes(cohort: :cohort_module_submission_windows)
            .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
          if enrollment
            cohort = enrollment.cohort
            json[:cohort_id] = cohort.id
            mod_gh = (cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
            requires_github = mod_gh["requires_github"] || false
            json[:requires_github] = requires_github
            json[:repository_name] = mod_gh["repository_name"].presence || cohort.repository_name
            json[:submission_window] = SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson)
          end
        end

        json[:requires_submission] = lesson.effective_requires_submission(requires_github: requires_github)
        json[:submission_type] = lesson.effective_submission_type(requires_github: requires_github)

        if include_content
          completion_block_ids = lesson.completion_block_ids.to_set
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
              has_s3_video: cb.s3_video_key.present?,
              completion_required: completion_block_ids.include?(cb.id),
              objective_ids: lesson.objective_alignments.select { |alignment| alignment.content_block_id == cb.id }
                .map(&:learning_objective_id)
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
                  created_at: s.created_at,
                  updated_at: s.updated_at
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

      def objective_json(lesson, include_inactive: false)
        alignments = lesson.objective_alignments.includes(:learning_objective, :content_block).ordered
        alignments = alignments.select { |alignment| alignment.learning_objective.active? } unless include_inactive
        alignments.map do |alignment|
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
