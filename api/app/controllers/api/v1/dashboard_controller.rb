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
        enrollment = current_user.enrollments.active.includes(:module_assignments, :lesson_assignments, cohort: { curriculum: { modules: { lessons: :content_blocks } } }).first

        unless enrollment
          render json: { dashboard: { enrolled: false, user: user_summary } }
          return
        end

        cohort = enrollment.cohort
        curriculum = cohort.curriculum
        assignments_by_module_id = enrollment.module_assignments.index_by(&:module_id)
        lesson_assignments_by_lesson_id = enrollment.lesson_assignments.index_by(&:lesson_id)
        modules = curriculum.modules.includes(lessons: :content_blocks).select do |mod|
          assignments_by_module_id.key?(mod.id)
        end

        # Calculate overall progress only across assigned modules
        all_block_ids = modules.flat_map { |mod| mod.lessons.flat_map { |lesson| lesson.content_blocks.map(&:id) } }

        user_progress = current_user.progresses.where(content_block_id: all_block_ids).index_by(&:content_block_id)
        completed_count = user_progress.values.count(&:completed?)
        total_count = all_block_ids.size
        overall_percentage = total_count > 0 ? (completed_count.to_f / total_count * 100).round(1) : 0

        # Build module data with progress
        modules_data = modules.map do |mod|
          assignment = assignments_by_module_id[mod.id]
          mod_block_ids = mod.lessons.flat_map { |l| l.content_blocks.map(&:id) }
          mod_completed = mod_block_ids.count { |id| user_progress[id]&.completed? }
          mod_total = mod_block_ids.size
          mod_percentage = mod_total > 0 ? (mod_completed.to_f / mod_total * 100).round(1) : 0

          {
            id: mod.id,
            name: mod.name,
            module_type: mod.module_type,
            position: mod.position,
            total_blocks: mod_total,
            completed_blocks: mod_completed,
            progress_percentage: mod_percentage,
            assigned: assignment.present?,
            unlocked: assignment&.accessible? || false,
            available: mod.lessons.any? { |lesson| lesson.available?(cohort, assignment, lesson_assignments_by_lesson_id[lesson.id]) },
            unlock_date: assignment&.next_unlock_date(cohort),
            lessons: mod.lessons.map { |l|
              lesson_block_ids = l.content_blocks.map(&:id)
              lesson_completed = lesson_block_ids.count { |id| user_progress[id]&.completed? }
              {
                id: l.id,
                title: l.title,
                lesson_type: l.lesson_type,
                release_day: l.release_day,
                required: l.required,
                available: l.available?(cohort, assignment, lesson_assignments_by_lesson_id[l.id]),
                unlock_date: lesson_assignments_by_lesson_id[l.id]&.unlock_date_override || l.unlock_date(cohort, assignment),
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

        # Action items: submissions with redo grade (most recent first)
        redo_submissions = current_user.submissions.where(grade: "R").includes(content_block: :lesson).order(graded_at: :desc).limit(5)
        action_items = redo_submissions.map { |s|
          {
            type: "redo",
            submission_id: s.id,
            lesson_id: s.content_block.lesson.id,
            lesson_title: s.content_block.lesson.title,
            content_block_title: s.content_block.title,
            feedback: s.feedback
          }
        }

        render json: {
          dashboard: {
            enrolled: true,
            user: user_summary,
            cohort: {
              id: cohort.id,
              name: cohort.name,
              start_date: cohort.start_date,
              status: cohort.status,
              announcements: Array((cohort.settings || {})["announcements"])
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
        cohorts = Cohort.active.includes(:enrollments).to_a

        if cohorts.empty?
          render json: { dashboard: { user: user_summary, cohorts: [] } }
          return
        end

        week_ago = 7.days.ago
        total_ungraded = 0

        cohorts_data = cohorts.map do |cohort|
          cohort_data = build_cohort_dashboard(cohort, week_ago)
          total_ungraded += cohort_data[:ungraded_count]
          cohort_data
        end

        # For backward compatibility, also include the first cohort's data
        # at the top level so existing frontend code keeps working
        primary = cohorts_data.first

        render json: {
          dashboard: {
            user: user_summary,
            cohort: primary[:cohort],
            students: primary[:students],
            ungraded_count: total_ungraded,
            cohorts: cohorts_data
          }
        }
      end

      def build_cohort_dashboard(cohort, week_ago)
        curriculum = cohort.curriculum
        all_block_ids = ContentBlock.joins(lesson: :curriculum_module)
          .where(modules: { curriculum_id: curriculum.id })
          .pluck(:id)

        total_blocks = all_block_ids.size

        enrollments = cohort.enrollments.active.includes(:user).to_a
        user_ids = enrollments.map { |e| e.user.id }

        progresses_by_user = Progress.completed
          .where(user_id: user_ids, content_block_id: all_block_ids)
          .select(:user_id, :content_block_id, :completed_at)
          .to_a
          .group_by(&:user_id)

        submissions_by_user = Submission
          .where(user_id: user_ids, content_block_id: all_block_ids)
          .select(:user_id, :content_block_id, :created_at)
          .to_a
          .group_by(&:user_id)

        students = enrollments.map do |enrollment|
          user = enrollment.user
          user_progresses = progresses_by_user[user.id] || []
          user_submissions = submissions_by_user[user.id] || []
          completed = user_progresses.size
          percentage = total_blocks > 0 ? (completed.to_f / total_blocks * 100).round(1) : 0

          last_completed_activity = user_progresses.map(&:completed_at).compact.max
          last_submission_activity = user_submissions.map(&:created_at).compact.max
          last_activity = [ last_completed_activity, last_submission_activity ].compact.max

          blocks_this_week = user_progresses.count { |p| p.completed_at && p.completed_at >= week_ago }
          submissions_this_week = user_submissions.count { |s| s.created_at && s.created_at >= week_ago }

          {
            user_id: user.id,
            full_name: user.full_name,
            email: user.email,
            github_username: user.github_username,
            progress_percentage: percentage,
            completed_blocks: completed,
            total_blocks: total_blocks,
            last_sign_in_at: user.last_sign_in_at,
            last_activity_at: last_activity,
            blocks_this_week: blocks_this_week,
            submissions_this_week: submissions_this_week,
            enrollment_status: enrollment.status
          }
        end

        ungraded_count = Submission.where(grade: nil)
          .joins(:user)
          .where(users: { id: user_ids })
          .count

        {
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
