module Api
  module V1
    class LessonsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      include LessonSerialization
      include LessonEditAuthorization
      # Lesson structure (create, settings, archive, restore, delete) stays
      # admin-only. Installed mobile builds' editor save follows the same
      # editing access as the web block editor (LessonEditAccess).
      before_action :require_admin!, except: [ :index, :show, :update_editor ]
      # One require_staff! declaration: a second one would replace this one.
      before_action :require_staff!, only: [ :index, :update_editor ]
      before_action :set_module, only: [ :index, :create, :create_exercise ]
      before_action :set_lesson, only: [ :show, :update, :update_editor, :archive, :restore, :destroy, :move, :duplicate ]
      before_action -> { require_lesson_edit_access!(@lesson.curriculum_module.curriculum) }, only: [ :update_editor ]
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
            .where(enrollment_id: @lesson_enrollment.id, content_block_id: block_ids)
            .index_by(&:content_block_id)

          submission_map = current_user.submissions
            .where(enrollment_id: @lesson_enrollment.id, content_block_id: block_ids)
            .order(created_at: :desc)
            .group_by(&:content_block_id)

          check_ids = KnowledgeCheck.where(content_block_id: block_ids).pluck(:id)
          knowledge_check_attempt_map = current_user.knowledge_check_attempts
            .where(enrollment_id: @lesson_enrollment.id, knowledge_check_id: check_ids)
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
            required: params.key?(:required) ? ActiveModel::Type::Boolean.new.cast(params[:required]) : true,
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
        @lesson.with_lock do
          require_current_resource_version!(@lesson)
          @lesson.update!(lesson_params)
        end
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::StaleObjectError
        render_stale_resource("Lesson")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # PATCH /api/v1/lessons/:id/archive
      def archive
        @lesson.with_lock do
          require_current_resource_version!(@lesson)
          @lesson.archive!
        end
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::StaleObjectError
        render_stale_resource("Lesson")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # PATCH /api/v1/lessons/:id/restore
      def restore
        @lesson.with_lock do
          require_current_resource_version!(@lesson)
          @lesson.restore!
        end
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::StaleObjectError
        render_stale_resource("Lesson")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # PATCH /api/v1/lessons/:id/editor
      # Saves the exercise editor as one unit so lesson fields, content blocks,
      # and objective alignments cannot drift apart on a partial request failure.
      # Replacing a video that students have progress on is refused with 422
      # unless editor.video.confirm_watch_reset is true, and then resets that
      # progress (see ContentBlocksController#update). Installed mobile builds
      # never send it, so they show the refusal instead of carrying old watch
      # credit over to the new video.
      def update_editor
        old_s3_key = nil
        new_s3_key = nil
        return unless prepare_editor_video_metadata!

        ApplicationRecord.transaction do
          # Storage is checked before the lesson or any block is locked.
          @editor_verified_video_key = verify_editor_video_key!
          recheck_lesson_edit_access!(@lesson.curriculum_module.curriculum)
          @lesson.with_authoring_lock do
            require_current_editor_version!
            lock_editor_blocks!
            @lesson.update!(editor_lesson_params)
            old_s3_key, new_s3_key = update_editor_video!
            update_editor_exercise!
            removed_check_block_id = update_editor_retrieval_check!
            replace_editor_objective_alignments!(removed_check_block_id: removed_check_block_id)
          end
        end

        if old_s3_key.present? && old_s3_key != new_s3_key
          S3ObjectCleanup.delete_if_unreferenced(old_s3_key)
        end

        @lesson.reload
        render json: { lesson: lesson_json(@lesson, include_content: true) }
      rescue ActiveRecord::StaleObjectError
        render json: {
          error: "Lesson changed after this editor was opened. Reload the latest version before saving.",
          code: "stale_editor"
        }, status: :conflict
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed => error
        render json: { errors: error.record.errors.full_messages.presence || [ error.message ] }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotFound, KeyError, ArgumentError => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end

      # POST /api/v1/lessons/:id/move
      # Moves the lesson to a day (and place in that day) of any module in its
      # curriculum, keeping its id so learner data stays attached
      # (LessonMove). dry_run: true returns the same checks and the learner
      # access impact without saving; expected_impact sends back the impact
      # the person confirmed, and the move is refused if it no longer holds.
      def move
        move = LessonMove.new(
          lesson: @lesson,
          module_id: params.require(:module_id),
          release_day: params.require(:release_day),
          position: params.require(:position),
          base_updated_at: params[:base_updated_at],
          expected_impact: expected_move_impact
        )
        if ActiveModel::Type::Boolean.new.cast(params[:dry_run])
          render json: { impact: move.preview }
        else
          impact = move.move!
          render json: { lesson: lesson_json(Lesson.includes(content_blocks: { knowledge_check: [ :learning_objective, :attempts ] }).find(@lesson.id), include_content: true), impact: impact }
        end
      rescue LessonMove::Stale
        render json: { error: "Lesson changed after you opened it. Reload it before moving.", code: "stale_editor" }, status: :conflict
      rescue LessonMove::ImpactChanged => error
        render json: { error: error.message, code: "impact_changed", impact: error.impact }, status: :unprocessable_entity
      rescue LessonMove::Invalid => error
        render json: { error: error.message, code: error.code }, status: :unprocessable_entity
      rescue ActiveRecord::RecordInvalid => error
        render json: { error: error.record.errors.full_messages.to_sentence, code: "invalid" }, status: :unprocessable_entity
      rescue ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout
        render json: { error: "Students were saving work in this lesson at the same moment, so it didn't move. Try again.", code: "retry" }, status: :unprocessable_entity
      end

      # POST /api/v1/lessons/:id/duplicate
      # Copies the lesson and its blocks as new rows, archived, right after
      # the original (LessonDuplicate). No learner data is copied.
      def duplicate
        copy = LessonDuplicate.new(lesson: @lesson, user: current_user).duplicate!
        render json: { lesson: lesson_json(Lesson.includes(content_blocks: { knowledge_check: [ :learning_objective, :attempts ] }).find(copy.id), include_content: true) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { error: error.record.errors.full_messages.to_sentence, code: "invalid" }, status: :unprocessable_entity
      end

      # DELETE /api/v1/lessons/:id
      def destroy
        @lesson.with_authoring_lock { @lesson.destroy! }
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed => error
        render json: { errors: error.record.errors.full_messages.presence || [ "Student evidence prevents deletion" ] }, status: :unprocessable_entity
      end

      private

      def expected_move_impact
        value = params[:expected_impact]
        value.is_a?(ActionController::Parameters) ? value.permit(*LessonMove::CONFIRMED_IMPACT).to_h : value.presence
      end

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
          :required,
          :requires_submission,
          :base_updated_at,
          video: [ :id, :title, :video_url, :confirm_watch_reset, :s3_video_key, :s3_video_content_type, :s3_video_size, { video_segments: [ :label, :start_seconds, :end_seconds, :required ] } ],
          exercise: [ :id, :title, :body, :solution, :filename, :submission_type, :rubric_id, { submission_config: {} } ],
          retrieval_check: [ :enabled, :content_block_id, :title, :prompt, :correct_option, :explanation, :learning_objective_id, { options: [] } ],
          alignments: [ :learning_objective_id, :content_block_id ]
        )
      end

      def editor_lesson_params
        editor_params.slice(:title, :required, :requires_submission)
      end

      def require_current_editor_version!
        base_updated_at = editor_params[:base_updated_at].presence
        unless base_updated_at
          raise ActiveRecord::StaleObjectError.new(@lesson, "update")
        end

        parsed_version = Time.iso8601(base_updated_at)
        return if parsed_version == @lesson.updated_at

        raise ActiveRecord::StaleObjectError.new(@lesson, "update")
      rescue ArgumentError
        raise ActiveRecord::StaleObjectError.new(@lesson, "update")
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
        if payload.key?(:video_segments)
          attributes[:metadata] = (block.metadata || {}).merge(
            "video_segments" => VideoSegmentSet.normalize(payload[:video_segments]),
            "video_segments_version" => VideoSegmentSet::CURRENT_VERSION,
            "video_segments_review_method" => "staff_authored",
            "video_segments_reviewed_at" => Date.current.iso8601
          )
        end
        if payload.key?(:s3_video_key) && payload[:s3_video_key] != old_s3_key
          attributes[:s3_video_key] = payload[:s3_video_key]
          attributes[:s3_video_content_type] = payload[:s3_video_key].present? ? @editor_video_content_type : nil
          attributes[:s3_video_size] = payload[:s3_video_key].present? ? @editor_video_size : nil
        end
        block.assign_attributes(attributes)
        block.confirm_watch_reset = ActiveModel::Type::Boolean.new.cast(payload[:confirm_watch_reset]) == true
        block.verified_s3_video_key = @editor_verified_video_key

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
        # A confirmed replacement resets watch progress in ContentBlock.
        block.save!

        [ old_s3_key, block.s3_video_key ]
      end

      def prepare_editor_video_metadata!
        payload = editor_params[:video]
        return true if payload.blank?

        @editor_video_content_type = nil
        @editor_video_size = nil
        return true unless editor_video_key_changes?(payload)
        return true if payload[:s3_video_key].blank?

        if payload[:s3_video_content_type].blank? || payload[:s3_video_size].blank?
          render json: { error: "Hosted video uploads require s3_video_content_type and s3_video_size" }, status: :unprocessable_entity
          return false
        end
        if payload[:s3_video_content_type].present?
          @editor_video_content_type = validated_video_content_type(payload[:s3_video_content_type])
          return false if performed?
        end
        if payload[:s3_video_size].present?
          @editor_video_size = Integer(payload[:s3_video_size].to_s, 10)
          unless @editor_video_size.between?(1, S3Service::MAX_UPLOAD_SIZE)
            render json: { error: "s3_video_size must be between 1 byte and 5 GB" }, status: :unprocessable_entity
            return false
          end
        end

        true
      rescue ArgumentError, TypeError
        render json: { error: "s3_video_size must be a whole number" }, status: :unprocessable_entity
        false
      end

      # Locks the blocks this save writes in one ascending id pass, the order
      # every block lock follows. The video (when its media changes) and a
      # retrieval check being removed are locked against learner writes;
      # the rest only against other authors (ContentBlock.lock_for_authoring!).
      def lock_editor_blocks!
        blocks = @lesson.content_blocks.to_a
        ids = []
        exclusive = []
        if (video = editor_params[:video]).present? && video[:id].present?
          block = blocks.find { |candidate| candidate.id == video[:id].to_i }
          if block
            ids << block.id
            key = video.key?(:s3_video_key) ? video[:s3_video_key].presence : block.s3_video_key
            url = video.key?(:video_url) ? video[:video_url] : block.video_url
            before = ContentBlock.playable_media(block.s3_video_key, block.video_url)
            exclusive << block.id if before.present? && before != ContentBlock.playable_media(key, url)
          end
        end
        ids << editor_params[:exercise][:id].to_i if editor_params[:exercise].present? && editor_params[:exercise][:id].present?
        if (check = editor_params[:retrieval_check]).present?
          check_block = if check[:content_block_id].present?
            blocks.find { |candidate| candidate.id == check[:content_block_id].to_i }
          else
            blocks.find { |candidate| candidate.checkpoint? && candidate.knowledge_check.present? }
          end
          if check_block
            ids << check_block.id
            exclusive << check_block.id unless ActiveModel::Type::Boolean.new.cast(check[:enabled])
          end
        end
        ContentBlock.lock_for_authoring!(ids & blocks.map(&:id), exclusive: exclusive)
      end

      # Checks the new hosted video in storage before any row is locked.
      def verify_editor_video_key!
        payload = editor_params[:video]
        return nil unless payload.present? && payload[:s3_video_key].present? && editor_video_key_changes?(payload)

        problem = S3ObjectCleanup.verify_attachment(payload[:s3_video_key])
        raise ArgumentError, "S3 video key #{problem}" if problem

        payload[:s3_video_key]
      end

      def editor_video_key_changes?(payload)
        return false unless payload.key?(:s3_video_key)
        return payload[:s3_video_key].present? if payload[:id].blank?

        block = @lesson.content_blocks.where(block_type: %i[video recording]).find_by(id: payload[:id])
        block.nil? || block.s3_video_key != payload[:s3_video_key]
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
          @lesson.content_blocks.find { |candidate| candidate.checkpoint? && candidate.knowledge_check.present? }
        end

        unless ActiveModel::Type::Boolean.new.cast(payload[:enabled])
          removed_block_id = block&.id
          block&.destroy!
          return removed_block_id
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
        nil
      end

      def replace_editor_objective_alignments!(removed_check_block_id: nil)
        requested = editor_params[:alignments] || []
        if requested.length > ObjectiveAlignmentsController::MAX_ALIGNMENTS
          @lesson.errors.add(:objectives, "can have at most #{ObjectiveAlignmentsController::MAX_ALIGNMENTS} alignments")
          raise ActiveRecord::RecordInvalid, @lesson
        end

        @lesson.objective_alignments.destroy_all
        requested.each_with_index do |alignment, position|
          objective = LearningObjective.find(alignment.fetch(:learning_objective_id))
          content_block_id = alignment[:content_block_id].presence
          content_block = content_block_id && content_block_id.to_i != removed_check_block_id ? @lesson.content_blocks.find(content_block_id) : nil
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

        access = LessonReadAccess.check(current_user, @lesson, cohort_id: params[:cohort_id])
        unless access.allowed?
          render_forbidden(access.error)
          return
        end

        @lesson_enrollment = access.enrollment
        @lesson_enrollment.record_first_course_open!
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
