module Api
  module V1
    class LessonsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :create, :create_exercise, :update, :update_editor, :archive, :restore ]
      before_action :require_admin!, only: [ :destroy ]
      before_action :set_module, only: [ :index, :create, :create_exercise ]
      before_action :set_lesson, only: [ :show, :update, :update_editor, :archive, :restore, :destroy ]
      before_action :authorize_lesson_read!, only: [ :show ]

      # GET /api/v1/modules/:module_id/lessons
      def index
        lessons = if current_user.staff?
          @module.all_lessons.includes(:curriculum_module, :content_blocks)
        else
          @module.lessons.includes(:curriculum_module, :content_blocks)
        end
        render json: {
          lessons: lessons.map { |l| lesson_json(l) }
        }
      end

      # GET /api/v1/lessons/:id
      def show
        # Include user progress if student
        progress_map = {}
        submission_map = {}
        knowledge_check_attempt_map = {}

        if current_user.student?
          block_ids = @lesson.content_blocks.pluck(:id)
          progress_map = current_user.progresses
            .where(content_block_id: block_ids)
            .index_by(&:content_block_id)

          submission_map = current_user.submissions
            .where(content_block_id: block_ids)
            .order(created_at: :desc)
            .group_by(&:content_block_id)

          check_ids = KnowledgeCheck.where(content_block_id: block_ids).pluck(:id)
          knowledge_check_attempt_map = current_user.knowledge_check_attempts
            .where(knowledge_check_id: check_ids)
            .order(created_at: :desc)
            .group_by(&:knowledge_check_id)
            .transform_values { |attempts| { attempt: attempts.first, count: attempts.length } }
        end

        render json: {
          lesson: lesson_json(
            @lesson,
            include_content: true,
            progress_map: progress_map,
            submission_map: submission_map,
            knowledge_check_attempt_map: knowledge_check_attempt_map
          )
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

          # Reserve the video block while a direct-to-S3 upload is still in
          # flight. The browser can create the exercise before the upload
          # finishes, then attach the resulting key to this stable row.
          if params[:video_url].present? || params[:s3_video_key].present? || pending_video_upload?
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

          # The upload coordinator needs the reserved video's id immediately;
          # omitting content_blocks leaves a completed S3 object waiting with
          # no database target and keeps the unload warning active forever.
          render json: { lesson: lesson_json(@lesson, include_content: true) }, status: :created
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

      # PATCH /api/v1/lessons/:id/archive
      def archive
        @lesson.archive!
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # PATCH /api/v1/lessons/:id/restore
      def restore
        @lesson.restore!
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
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
          update_editor_retrieval_check!
          replace_editor_objective_alignments!
        end

        if old_s3_key.present? && old_s3_key != new_s3_key
          S3ObjectCleanup.delete_if_unreferenced(old_s3_key)
        end

        @lesson.reload
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed, ActiveRecord::RecordNotFound, KeyError => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end

      # DELETE /api/v1/lessons/:id
      def destroy
        @lesson.destroy!
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed => error
        render json: { errors: error.record.errors.full_messages.presence || [ "Student evidence prevents deletion" ] }, status: :unprocessable_entity
      end

      private

      def set_module
        @module = CurriculumModule.find(params[:module_id])
      end

      def set_lesson
        @lesson = Lesson.includes(content_blocks: { knowledge_check: [ :learning_objective, :attempts ] }).find(params[:id])
      end

      def lesson_params
        params.permit(:title, :lesson_type, :position, :release_day, :required, :requires_submission)
      end

      def pending_video_upload?
        ActiveModel::Type::Boolean.new.cast(params[:video_upload_pending])
      end

      def editor_params
        params.require(:editor).permit(
          :title,
          :requires_submission,
          video: [ :id, :title, :video_url, :s3_video_key ],
          exercise: [ :id, :title, :body, :solution, :filename, :submission_type, :rubric_id, { submission_config: {} } ],
          retrieval_check: [ :enabled, :content_block_id, :title, :prompt, :correct_option, :explanation, :learning_objective_id, { options: [] } ],
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

      def update_editor_retrieval_check!
        payload = editor_params[:retrieval_check]
        return if payload.blank?

        block = if payload[:content_block_id].present?
          @lesson.content_blocks.where(block_type: :checkpoint).find(payload[:content_block_id])
        else
          @lesson.content_blocks.find_by(block_type: :checkpoint)
        end

        unless ActiveModel::Type::Boolean.new.cast(payload[:enabled])
          block&.destroy!
          return
        end

        block ||= @lesson.content_blocks.create!(
          block_type: :checkpoint,
          position: next_editor_block_position,
          title: payload[:title].presence || "Quick check"
        )
        block.update!(title: payload[:title].presence || "Quick check")
        check = block.knowledge_check || block.build_knowledge_check
        check.update!(
          prompt: payload[:prompt],
          options: Array(payload[:options]).map(&:strip),
          correct_option: payload[:correct_option],
          explanation: payload[:explanation],
          learning_objective_id: payload[:learning_objective_id].presence
        )
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

        if @lesson.archived?
          render_forbidden("Cannot access this lesson")
          return
        end

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

      def lesson_json(lesson, include_content: false, progress_map: {}, submission_map: {}, knowledge_check_attempt_map: {})
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
          archived_at: lesson.archived_at,
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
                .map(&:learning_objective_id),
              rubric: rubric_json(cb.rubric, submission_map[cb.id]&.first),
              knowledge_check: knowledge_check_json(cb.knowledge_check, knowledge_check_attempt_map)
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

      def rubric_json(rubric, submission = nil)
        return nil unless rubric&.active? || (rubric && current_user.staff?)

        results = submission&.submission_criterion_results&.index_by(&:rubric_criterion_id) || {}
        {
          id: rubric.id,
          title: rubric.title,
          description: rubric.description,
          criteria: rubric.rubric_criteria.ordered.map do |criterion|
            result = results[criterion.id]
            {
              id: criterion.id,
              title: criterion.title,
              description: criterion.description,
              objective_code: criterion.learning_objective&.code,
              rating: result&.rating,
              feedback: result&.feedback
            }
          end
        }
      end

      def knowledge_check_json(check, attempt_map)
        return nil unless check

        attempt_info = attempt_map[check.id] || {}
        attempt = attempt_info[:attempt]
        json = {
          id: check.id,
          prompt: check.prompt,
          options: check.options,
          objective_code: check.learning_objective&.code,
          attempt_count: current_user.staff? ? check.attempts.size : attempt_info[:count].to_i,
          latest_attempt: attempt ? {
            id: attempt.id,
            selected_option: attempt.selected_option,
            correct: attempt.correct,
            correct_option: check.correct_option,
            explanation: check.explanation,
            created_at: attempt.created_at
          } : nil
        }
        if current_user.staff?
          json[:correct_option] = check.correct_option
          json[:explanation] = check.explanation
          json[:learning_objective_id] = check.learning_objective_id
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
