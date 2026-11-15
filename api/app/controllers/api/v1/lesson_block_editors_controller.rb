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
        render json: { error: error.message, code: error.code, block_ids: error.block_ids }.compact, status: :unprocessable_entity
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
        params.require(:lesson).permit(
          :base_updated_at, :title, :required, :release_day,
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
      end

      def editor_json
        {
          lesson: lesson_json(@lesson, include_content: true),
          block_activity: block_activity_json,
          context: context_json,
          access: LessonEditAccess.for(current_user, @lesson.curriculum_module.curriculum).as_json
        }
      end

      def block_activity_json
        ContentBlock.learner_evidence_for(@lesson.content_blocks.map(&:id)).map do |id, counts|
          { content_block_id: id, **counts }
        end
      end

      def context_json
        mod = @lesson.curriculum_module
        curriculum = mod.curriculum
        block_ids = @lesson.content_blocks.map(&:id)
        submissions = Submission.where(content_block_id: block_ids)
        weeks = [ mod.week_count, @lesson.release_day / 7 + 1 ].max + 1
        {
          curriculum: { id: curriculum.id, name: curriculum.name },
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
          used_in: curriculum.cohorts.order(:start_date, :id).map do |cohort|
            { id: cohort.id, name: cohort.name, status: cohort.status, start_date: cohort.start_date&.iso8601 }
          end,
          submissions_count: submissions.count,
          waiting_count: submissions.where(grade: nil).count,
          open_help_count: HelpRequest.where(context_type: :lesson, context_id: @lesson.id, status: %i[open acknowledged]).count
        }
      end
    end
  end
end
