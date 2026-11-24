module Api
  module V1
    # The web block lesson editor (W5 PR 5.3): every block in order, lesson
    # settings and the context the editor shows (breadcrumb, schedule choices,
    # where the lesson is used and which blocks hold learner work). Saving
    # goes through LessonBlockEditor in one transaction. The older
    # PATCH /lessons/:id/editor stays as it is for installed mobile builds.
    #
    # Staff can open it; `access` says whether this person may save
    # (LessonEditAccess: admins, or instructors with editing access for every
    # cohort using the curriculum). Everyone else sees it read-only.
    class LessonBlockEditorsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      include LessonSerialization
      include LessonEditAuthorization
      before_action :require_staff!
      before_action :set_lesson
      before_action -> { require_lesson_edit_access!(@lesson.curriculum_module.curriculum) }, only: :update

      # GET /api/v1/lessons/:lesson_id/block_editor
      def show
        render json: editor_json
      end

      # PUT /api/v1/lessons/:lesson_id/block_editor
      def update
        curriculum = @lesson.curriculum_module.curriculum
        LessonBlockEditor.new(
          lesson: @lesson, params: editor_params, user: current_user,
          before_lock: -> { recheck_lesson_edit_access!(curriculum) }
        ).save!
        set_lesson
        render json: editor_json
      rescue LessonBlockEditor::Stale
        render json: {
          error: "Someone else saved this lesson after you opened it. Your changes are still here: copy anything you need, then reload to see their version.",
          code: "stale_editor"
        }, status: :conflict
      rescue LessonBlockEditor::Invalid => error
        render json: { error: error.message, code: error.code, block_ids: error.block_ids, completion_impact: error.completion_impact }.compact, status: :unprocessable_entity
      end

      private

      def set_lesson
        @lesson = Lesson.includes(
          { curriculum_module: :curriculum },
          { content_blocks: [ :s3_video_uploaded_by, { rubric: { rubric_criteria: :learning_objective } }, { knowledge_check: [ :learning_objective, :attempts ] } ] },
          :objective_alignments
        ).find(params[:lesson_id])
      end

      def editor_params
        raw = params.require(:lesson)
        # Check before strong parameters can discard an invalid section shape.
        if raw[:blocks].is_a?(Array)
          raw[:blocks].grep(ActionController::Parameters).each { |block| VideoSegmentSet.validate_authoring_shape!(block) }
        end
        raw.permit(
          :base_updated_at, :title, :required, :release_day, :confirm_reopen_completed_count,
          removed_block_ids: [],
          confirm_watch_reset_block_ids: [],
          blocks: [
            :id, :client_id, :block_type, :title, :body, :solution, :filename, :video_url,
            :submission_type, :rubric_id, :s3_video_key, :s3_video_content_type, :s3_video_size,
            { submission_config: {} }, { metadata: {} },
            { video_segments: [ :label, :start_seconds, :end_seconds, :required ] },
            { knowledge_check: [ :prompt, :correct_option, :explanation, :learning_objective_id, { options: [] } ] }
          ],
          alignments: [ :learning_objective_id, :content_block_id, :block_client_id ]
        )
      rescue ArgumentError => error
        raise LessonBlockEditor::Invalid.new(error.message)
      end

      def editor_json
        {
          lesson: lesson_json(@lesson, include_content: true),
          block_activity: block_activity_json,
          context: context_json,
          completion_impact: LessonCompletionImpact.for_lesson(@lesson, viewer: current_user),
          access: LessonEditAccess.for(current_user, @lesson.curriculum_module.curriculum).as_json
        }
      end

      # Counted in the cohorts this person may see (StaffCohortScope). Anyone
      # who may edit sees every cohort on the curriculum, so the counts that
      # guard a delete or a video swap are never narrowed for them; the save
      # itself always checks every learner's work (LessonBlockEditor).
      def block_activity_json
        curriculum_id = @lesson.curriculum_module.curriculum_id
        evidence = ContentBlock.learner_evidence_for(@lesson.content_blocks.map(&:id), enrollment_ids: cohort_scope.enrollment_ids(curriculum_id))
        evidence.map do |id, counts|
          { content_block_id: id, **counts }
        end
      end

      # Cohorts and counts are limited to the cohorts this staff member can
      # see (StaffCohortScope, the rule RecordUsage follows): admins see all, instructors only the cohorts
      # they teach, with the rest as a number for the shared-curriculum notice.
      def context_json
        mod = @lesson.curriculum_module
        curriculum = mod.curriculum
        block_ids = @lesson.content_blocks.map(&:id)
        visible_ids = cohort_scope.visible_ids(curriculum.id)
        submissions = Submission.where(content_block_id: block_ids, enrollment_id: Enrollment.where(cohort_id: visible_ids).select(:id))
        weeks = [ mod.week_count, @lesson.release_day / 7 + 1 ].max + 1
        {
          curriculum: CurriculumName.new(current_user).ref(curriculum),
          module: {
            id: mod.id,
            name: mod.name,
            release_days: (1..weeks).flat_map do |week|
              mod.scheduled_weekday_indices.sort.map do |weekday_index|
                release_day = mod.release_day_for(week: week, weekday_index: weekday_index)
                { release_day: release_day, week: week, day_name: CurriculumModule::DAY_NAMES[weekday_index] }
              end
            end
          },
          used_in: Cohort.where(id: visible_ids).order(:start_date, :id).map do |cohort|
            { id: cohort.id, name: cohort.name, status: cohort.effective_status, start_date: cohort.start_date&.iso8601 }
          end,
          other_cohorts_count: cohort_scope.other_count(curriculum.id),
          github_grade_suggestions_configured: FeatureSwitches.school(read_only: true)["github_grade_suggestions"] == true,
          submissions_count: submissions.count,
          # Latest attempts without a grade, as Grading counts them.
          waiting_count: submissions.latest_attempts.where(grade: nil).count,
          open_help_count: HelpRequest.where(context_type: :lesson, context_id: @lesson.id).or(HelpRequest.where(context_type: :exercise, context_id: block_ids))
            .active_queue.where(cohort_id: visible_ids).count
        }
      end
    end
  end
end
