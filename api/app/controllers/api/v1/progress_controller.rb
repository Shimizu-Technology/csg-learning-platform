module Api
  module V1
    class ProgressController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_student!, only: [ :update ]

      # PATCH /api/v1/progress
      def update
        content_block = ContentBlock.find(params[:content_block_id])
        authorize_content_block_write!(content_block)
        return if performed?
        if content_block.evidence_controls_completion?(@learning_write_enrollment)
          required_action = if content_block.knowledge_check.present?
            "Answer the retrieval check correctly to complete this checkpoint. Progress is recorded through your attempts."
          else
            case content_block.submission_type_for(@learning_write_enrollment)
            when "text_submission" then "Submit your answer for review. Progress changes through submission and grading."
            when "repo_url_submission" then "Submit your repository URL for review. Progress changes through submission and grading."
            when "repo_and_live_url_submission" then "Submit your repository and live URLs for review. Progress changes through submission and grading."
            when "prework_github_sync" then "Complete your GitHub work and sync it for review. Progress changes through GitHub sync and grading."
            end
          end
          render json: { error: required_action }, status: :unprocessable_entity
          return
        end
        if params[:status].to_s == "completed" && content_block.student_work_block?
          authorize_submission_window_open!(content_block)
          return if performed?
        end

        with_learning_write_guard(@learning_write_enrollment) do
          return unless recheck_content_block_write!(content_block, @learning_write_enrollment)

          progress = Progress.find_or_initialize_by(
            enrollment: @learning_write_enrollment,
            content_block: content_block
          )
          progress.user = current_user
          previous_status = progress.status
          progress.status = params[:status]

          if progress.save
            if previous_status != progress.status && (progress.completed? || previous_status == "completed")
              video = %w[video recording].include?(content_block.block_type)
              ActivityEvent.record!(
                event_type: progress.completed? ? "checkpoint_completed" : "checkpoint_reopened",
                actor: current_user,
                cohort: @learning_write_enrollment&.cohort,
                record: content_block,
                evidence: video ? "player_reported" : "server_record"
              )
            end
            render json: {
              progress: {
                id: progress.id,
                content_block_id: progress.content_block_id,
                status: progress.status,
                completed_at: progress.completed_at
              }
            }
          else
            render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      # GET /api/v1/progress — get current user's progress for a module or lesson
      def index
        if params[:module_id].present?
          mod = CurriculumModule.find(params[:module_id])
          block_ids = ContentBlock.joins(:lesson).where(lessons: { module_id: mod.id }).pluck(:id)
        elsif params[:lesson_id].present?
          lesson = Lesson.find(params[:lesson_id])
          block_ids = lesson.content_blocks.pluck(:id)
        else
          # All progress for current user
          block_ids = nil
        end

        progresses = current_user.progresses
        if params[:cohort_id].present?
          cohort = Cohort.find(params[:cohort_id])
          return unless require_cohort_access!(cohort)
          progresses = progresses.where(enrollment_id: current_user.enrollments.where(cohort_id: cohort.id).select(:id))
        end
        progresses = progresses.where(content_block_id: block_ids) if block_ids

        render json: {
          progress: progresses.map { |p|
            {
              id: p.id,
              content_block_id: p.content_block_id,
              status: p.status,
              completed_at: p.completed_at
            }
          }
        }
      end

      # GET /api/v1/progress/student/:user_id — admin: view detailed student progress
      def student
        require_staff!
        return if performed?

        user = User.find(params[:user_id])
        enrollments = user.enrollments.includes(
          :module_assignments,
          :lesson_assignments,
          cohort: [
            :cohort_module_schedules,
            :cohort_module_submission_windows,
            { curriculum: { modules: { lessons: :content_blocks } } }
          ]
        )
        enrollment = if params[:cohort_id].present?
          enrollments.find_by(cohort_id: params[:cohort_id])
        else
          enrollments.active.first
        end

        unless enrollment
          message = params[:cohort_id].present? ? "Student is not enrolled in this cohort" : "Student is not enrolled in an active cohort"
          render json: { error: message }, status: :not_found
          return
        end

        cohort = enrollment.cohort
        return unless require_cohort_access!(cohort, teacher: true)
        curriculum = cohort.curriculum
        same_curriculum_enrollment_count = user.enrollments.joins(:cohort)
          .where(cohorts: { curriculum_id: curriculum.id })
          .count
        # The enrollment preload already loaded curriculum -> modules -> lessons -> content_blocks.
        # Keep everything in memory here so we don't undo that eager loading with fresh queries.
        modules = curriculum.modules.sort_by(&:position)
        modules_by_id = modules.index_by(&:id)
        module_assignments_by_module_id = enrollment.module_assignments.index_by(&:module_id)
        lesson_assignments_by_lesson_id = enrollment.lesson_assignments.index_by(&:lesson_id)

        content = AssignedLearningContent.new(enrollment)
        learner_progress = LearnerProgress.new(enrollment, content: content)
        # Staff see the entire curriculum, including this enrollment's retained
        # evidence from removed assignments and non-completion blocks. Learning
        # records from other enrollments remain separate.
        displayed_block_ids = modules.flat_map { |mod| mod.lessons.flat_map { |lesson| lesson.content_blocks.map(&:id) } }
        progress_by_block = user.progresses.where(enrollment_id: enrollment.id, content_block_id: displayed_block_ids).index_by(&:content_block_id)
        submissions_by_block = user.submissions.where(enrollment_id: enrollment.id, content_block_id: displayed_block_ids)
          .order(created_at: :desc)
          .group_by(&:content_block_id)
          .transform_values(&:first) # latest submission per block

        # Build a flat lookup map from already-loaded data for recent_activity (avoids N+1)
        all_blocks_by_id = modules.flat_map { |m|
          m.lessons.flat_map { |l| l.content_blocks.map { |b| [ b.id, b ] } }
        }.to_h

        # Assigned lessons stand exactly as the learner sees them (LearnerProgress).
        overall = learner_progress.overall

        modules_data = modules.map do |mod|
          module_progress = learner_progress.module_progress(mod)
          assigned_lessons = module_progress.lessons.index_by { |entry| entry.lesson.id }

          {
            id: mod.id,
            name: mod.name,
            module_type: mod.module_type,
            position: mod.position,
            total_blocks: module_progress.total_blocks,
            completed_blocks: module_progress.completed_blocks,
            progress_percentage: module_progress.progress_percentage,
            lessons: mod.lessons.map do |lesson|
              entry = assigned_lessons[lesson.id]
              assigned = entry.present?
              module_assignment = module_assignments_by_module_id[mod.id]
              lesson_assignment = lesson_assignments_by_lesson_id[lesson.id]

              {
                id: lesson.id,
                title: lesson.title,
                lesson_type: lesson.lesson_type,
                position: lesson.position,
                release_day: lesson.release_day,
                required: enrollment.lesson_required?(lesson),
                review_status: LessonReviewStatus.for(lesson, submissions_by_block),
                submission_window: SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson),
                assigned: assigned,
                available: entry&.available || false,
                unlock_date: lesson.assigned_unlock_date(cohort, module_assignment, lesson_assignment),
                total_blocks: entry&.total_blocks || 0,
                completed_blocks: entry&.completed_blocks || 0,
                completed: entry&.completed || false,
                lesson_assignment: lesson_assignment ? {
                  id: lesson_assignment.id,
                  unlocked: lesson_assignment.unlocked,
                  unlock_date_override: lesson_assignment.unlock_date_override
                } : nil,
                blocks: lesson.content_blocks.sort_by(&:position).map do |block|
                  progress = progress_by_block[block.id]
                  submission = submissions_by_block[block.id]
                  {
                    id: block.id,
                    title: block.title,
                    block_type: block.block_type,
                    position: block.position,
                    status: progress&.status || "not_started",
                    completed_at: progress&.completed_at,
                    submission: submission ? {
                      id: submission.id,
                      grade: submission.grade,
                      feedback: submission.feedback,
                      submitted_at: submission.created_at,
                      graded_at: submission.graded_at
                    } : nil
                  }
                end
              }
            end
          }
        end

        # Recent activity: last 10 completed blocks
        # Use all_blocks_by_id lookup map (built from eager-loaded data) to avoid N+1
        recent_activity = progress_by_block.values
          .select(&:completed?)
          .sort_by { |p| -(p.completed_at&.to_i || 0) }
          .first(10)
          .map do |p|
            block = all_blocks_by_id[p.content_block_id]
            next nil unless block
            { content_block_id: p.content_block_id, block_title: block.title, block_type: block.block_type, completed_at: p.completed_at }
          end
          .compact

        render json: {
          personal_plan: LearningPlanProjection.new(enrollment, progress: learner_progress).call,
          weekly_plan: WeeklyPlanProjection.new(user, cohort_id: cohort.id, record_open: false).call,
          enrollment: {
            id: enrollment.id,
            restart_version: enrollment.restart_version,
            status: enrollment.status,
            access_expires_at: enrollment.access_expires_at,
            support_expires_at: enrollment.support_expires_at,
            first_opened_at: enrollment.first_opened_at,
            module_assignments: enrollment.module_assignments.map do |assignment|
              # The curriculum's modules are loaded with their lessons, which
              # availability and unlock dates read; reuse them per assignment.
              loaded_module = modules_by_id[assignment.module_id]
              assignment.association(:curriculum_module).target = loaded_module if loaded_module
              {
                id: assignment.id,
                module_id: assignment.module_id,
                module_name: assignment.curriculum_module.name,
                module_type: assignment.curriculum_module.module_type,
                unlocked: assignment.unlocked,
                unlock_date_override: assignment.unlock_date_override,
                available: assignment.available_for?(cohort),
                next_unlock_date: assignment.next_unlock_date(cohort)
              }
            end
          },
          user: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            github_username: user.github_username,
            avatar_url: user.avatar_url,
            last_sign_in_at: user.last_sign_in_at,
            last_seen_at: user.last_seen_at
          },
          cohort: {
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            status: cohort.effective_status,
            course_delivery: cohort.course_delivery
          },
          learning_evidence_scope: {
            kind: "enrollment",
            curriculum_id: curriculum.id,
            curriculum_name: curriculum.name,
            enrollment_count: same_curriculum_enrollment_count,
            shared_across_enrollments: false
          },
          overall_progress: overall,
          modules: modules_data,
          recent_activity: recent_activity
        }
      end
    end
  end
end
