module Api
  module V1
    class ProgressController < ApplicationController
      before_action :authenticate_user!

      # PATCH /api/v1/progress
      def update
        content_block = ContentBlock.find(params[:content_block_id])

        progress = Progress.find_or_initialize_by(
          user: current_user,
          content_block: content_block
        )

        progress.status = params[:status]

        if progress.save
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
        enrollment = user.enrollments.active.includes(cohort: { curriculum: { modules: { lessons: :content_blocks } } }).first

        unless enrollment
          render json: { error: "Student is not enrolled in an active cohort" }, status: :not_found
          return
        end

        cohort = enrollment.cohort
        curriculum = cohort.curriculum
        # The enrollment preload already loaded curriculum -> modules -> lessons -> content_blocks.
        # Keep everything in memory here so we don't undo that eager loading with fresh queries.
        modules = curriculum.modules.sort_by(&:position)

        # Index all progresses and submissions for this user
        all_block_ids = modules.flat_map { |m| m.lessons.flat_map { |l| l.content_blocks.map(&:id) } }
        progress_by_block = user.progresses.where(content_block_id: all_block_ids).index_by(&:content_block_id)
        submissions_by_block = user.submissions.where(content_block_id: all_block_ids)
          .order(created_at: :desc)
          .group_by(&:content_block_id)
          .transform_values(&:first) # latest submission per block

        # Build a flat lookup map from already-loaded data for recent_activity (avoids N+1)
        all_blocks_by_id = modules.flat_map { |m|
          m.lessons.flat_map { |l| l.content_blocks.map { |b| [ b.id, b ] } }
        }.to_h

        total_blocks = all_block_ids.size
        completed_blocks = progress_by_block.values.count(&:completed?)
        overall_percentage = total_blocks > 0 ? (completed_blocks.to_f / total_blocks * 100).round(1) : 0

        modules_data = modules.map do |mod|
          mod_block_ids = mod.lessons.flat_map { |l| l.content_blocks.map(&:id) }
          mod_completed = mod_block_ids.count { |id| progress_by_block[id]&.completed? }
          mod_total = mod_block_ids.size
          mod_pct = mod_total > 0 ? (mod_completed.to_f / mod_total * 100).round(1) : 0

          {
            id: mod.id,
            name: mod.name,
            module_type: mod.module_type,
            position: mod.position,
            total_blocks: mod_total,
            completed_blocks: mod_completed,
            progress_percentage: mod_pct,
            lessons: mod.lessons.sort_by(&:position).map do |lesson|
              lesson_block_ids = lesson.content_blocks.map(&:id)
              lesson_completed = lesson_block_ids.count { |id| progress_by_block[id]&.completed? }
              lesson_total = lesson_block_ids.size
              available = lesson.available?(cohort)

              {
                id: lesson.id,
                title: lesson.title,
                lesson_type: lesson.lesson_type,
                position: lesson.position,
                release_day: lesson.release_day,
                required: lesson.required,
                available: available,
                unlock_date: lesson.unlock_date(cohort),
                total_blocks: lesson_total,
                completed_blocks: lesson_completed,
                completed: lesson_completed == lesson_total && lesson_total > 0,
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
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            module_assignments: enrollment.module_assignments.includes(:curriculum_module).map do |assignment|
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
            last_sign_in_at: user.last_sign_in_at
          },
          cohort: {
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            status: cohort.status
          },
          overall_progress: {
            completed: completed_blocks,
            total: total_blocks,
            percentage: overall_percentage
          },
          modules: modules_data,
          recent_activity: recent_activity
        }
      end
    end
  end
end
