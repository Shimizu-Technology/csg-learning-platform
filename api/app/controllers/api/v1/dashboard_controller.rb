module Api
  module V1
    class DashboardController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/dashboard
      def show
        if current_user.staff?
          render_admin_dashboard
        else
          render_student_dashboard
        end
      end

      private

      def render_student_dashboard
        enrollment = current_user.enrollments.active.includes(cohort: { curriculum: { modules: { lessons: :content_blocks } } }).first

        unless enrollment
          render json: { dashboard: { enrolled: false, user: user_summary } }
          return
        end

        cohort = enrollment.cohort
        curriculum = cohort.curriculum
        modules = curriculum.modules.includes(lessons: :content_blocks)

        # Calculate overall progress
        all_block_ids = ContentBlock.joins(lesson: :curriculum_module)
          .where(modules: { curriculum_id: curriculum.id })
          .pluck(:id)

        user_progress = current_user.progresses.where(content_block_id: all_block_ids).index_by(&:content_block_id)
        completed_count = user_progress.values.count(&:completed?)
        total_count = all_block_ids.size
        overall_percentage = total_count > 0 ? (completed_count.to_f / total_count * 100).round(1) : 0

        # Build module data with progress
        modules_data = modules.map do |mod|
          mod_block_ids = mod.lessons.flat_map { |l| l.content_blocks.map(&:id) }
          mod_completed = mod_block_ids.count { |id| user_progress[id]&.completed? }
          mod_total = mod_block_ids.size
          mod_percentage = mod_total > 0 ? (mod_completed.to_f / mod_total * 100).round(1) : 0

          # Get today's available lessons
          today_lessons = mod.lessons.select { |l| l.available?(cohort) }

          {
            id: mod.id,
            name: mod.name,
            module_type: mod.module_type,
            position: mod.position,
            total_blocks: mod_total,
            completed_blocks: mod_completed,
            progress_percentage: mod_percentage,
            lessons: mod.lessons.map { |l|
              lesson_block_ids = l.content_blocks.map(&:id)
              lesson_completed = lesson_block_ids.count { |id| user_progress[id]&.completed? }
              {
                id: l.id,
                title: l.title,
                lesson_type: l.lesson_type,
                release_day: l.release_day,
                required: l.required,
                available: l.available?(cohort),
                unlock_date: l.unlock_date(cohort),
                total_blocks: lesson_block_ids.size,
                completed_blocks: lesson_completed,
                completed: lesson_completed == lesson_block_ids.size && lesson_block_ids.any?
              }
            }
          }
        end

        # Find "continue" lesson — first incomplete available lesson
        continue_lesson = nil
        modules_data.each do |mod_data|
          mod_data[:lessons].each do |lesson_data|
            if lesson_data[:available] && !lesson_data[:completed]
              continue_lesson = { id: lesson_data[:id], title: lesson_data[:title] }
              break
            end
          end
          break if continue_lesson
        end

        # Action items: ungraded submissions with redo grade
        redo_submissions = current_user.submissions.where(grade: "R").includes(:content_block).limit(5)
        action_items = redo_submissions.map { |s|
          { type: "redo", submission_id: s.id, lesson_title: s.content_block.lesson.title, content_block_title: s.content_block.title }
        }

        render json: {
          dashboard: {
            enrolled: true,
            user: user_summary,
            cohort: {
              id: cohort.id,
              name: cohort.name,
              start_date: cohort.start_date,
              status: cohort.status
            },
            overall_progress: {
              completed: completed_count,
              total: total_count,
              percentage: overall_percentage
            },
            modules: modules_data,
            continue_lesson: continue_lesson,
            action_items: action_items
          }
        }
      end

      def render_admin_dashboard
        # Get active cohort
        cohort = Cohort.active.includes(:enrollments).first

        unless cohort
          render json: { dashboard: { user: user_summary, cohorts: [] } }
          return
        end

        curriculum = cohort.curriculum
        all_block_ids = ContentBlock.joins(lesson: :curriculum_module)
          .where(modules: { curriculum_id: curriculum.id })
          .pluck(:id)

        total_blocks = all_block_ids.size

        # Student progress data
        students = cohort.enrollments.active.includes(:user).map do |enrollment|
          user = enrollment.user
          completed = user.progresses.completed.where(content_block_id: all_block_ids).count
          percentage = total_blocks > 0 ? (completed.to_f / total_blocks * 100).round(1) : 0

          {
            user_id: user.id,
            full_name: user.full_name,
            email: user.email,
            github_username: user.github_username,
            progress_percentage: percentage,
            completed_blocks: completed,
            total_blocks: total_blocks,
            last_sign_in_at: user.last_sign_in_at,
            enrollment_status: enrollment.status
          }
        end

        # Ungraded submissions count
        ungraded_count = Submission.where(grade: nil)
          .joins(:user)
          .where(users: { id: cohort.users.pluck(:id) })
          .count

        render json: {
          dashboard: {
            user: user_summary,
            cohort: {
              id: cohort.id,
              name: cohort.name,
              start_date: cohort.start_date,
              status: cohort.status,
              enrolled_count: cohort.enrollments.count,
              active_count: cohort.enrollments.active.count
            },
            students: students.sort_by { |s| -s[:progress_percentage] },
            ungraded_count: ungraded_count
          }
        }
      end

      def user_summary
        {
          id: current_user.id,
          full_name: current_user.full_name,
          email: current_user.email,
          role: current_user.role,
          avatar_url: current_user.avatar_url,
          is_admin: current_user.admin?,
          is_staff: current_user.staff?
        }
      end
    end
  end
end
