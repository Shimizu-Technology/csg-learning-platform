module Api
  module V1
    class DashboardController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/dashboard
      def show
        if params[:cohort_id].present?
          @selected_cohort = Cohort.find_by(id: params[:cohort_id])
          unless current_user.can_access_cohort?(@selected_cohort)
            render_forbidden("Cannot access this cohort")
            return
          end
        end

        if current_user.staff?
          render_admin_dashboard
        else
          render_student_dashboard
        end
      end

      private

      def render_student_dashboard
        enrollment_scope = current_user.enrollments.includes(
          :module_assignments,
          :lesson_assignments,
          cohort: [
            :cohort_module_schedules,
            :cohort_module_submission_windows,
            :office_hours,
            :private_meeting_config,
            { curriculum: { modules: { lessons: :content_blocks } } }
          ]
        )
        enrollment_scope = if @selected_cohort
          enrollment_scope.with_read_access.where(cohort_id: @selected_cohort.id)
        else
          enrollment_scope.active
        end
        enrollment = enrollment_scope.first

        unless enrollment
          render json: { dashboard: { enrolled: false, user: user_summary,
            catalog_enabled: Cohort.where(course_delivery: "self_paced", status: :active, public_checkout_enabled: true).exists?,
            pending_purchases: current_user.course_purchases.where(status: "pending").includes(:cohort).map { |purchase|
              { id: purchase.id, cohort_id: purchase.cohort_id, course_name: purchase.cohort.name }
            } } }
          return
        end
        enrollment.mark_joined!

        enrollment.record_first_course_open! if enrollment.active?

        cohort = enrollment.cohort
        content = AssignedLearningContent.new(enrollment)
        assignments_by_module_id = content.module_assignments
        lesson_assignments_by_lesson_id = content.lesson_assignments
        modules = content.modules

        all_block_ids = content.completion_block_ids

        user_progress = current_user.progresses.where(enrollment_id: enrollment.id, content_block_id: all_block_ids).index_by(&:content_block_id)
        completed_count = user_progress.values.count(&:completed?)
        total_count = all_block_ids.size
        overall_percentage = total_count > 0 ? (completed_count.to_f / total_count * 100).round(1) : 0

        latest_submission_ids = current_user.submissions
          .where(enrollment_id: enrollment.id, content_block_id: all_block_ids)
          .group(:content_block_id)
          .select("MAX(id)")
        latest_submissions = current_user.submissions
          .where(id: latest_submission_ids)
          .includes(content_block: :lesson)
          .to_a
        latest_submissions_by_block = latest_submissions.index_by(&:content_block_id)

        # Build module data with progress
        modules_data = modules.map do |mod|
          assignment = assignments_by_module_id[mod.id]
          mod_block_ids = content.lessons_for(mod).flat_map(&:completion_block_ids)
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
            unlocked: assignment&.accessible?(cohort) || false,
            available: content.lessons_for(mod).any? { |lesson| lesson.available?(cohort, assignment, lesson_assignments_by_lesson_id[lesson.id]) },
            unlock_date: assignment&.next_unlock_date(cohort),
            lessons: content.lessons_for(mod).map { |l|
              lesson_block_ids = l.completion_block_ids
              lesson_completed = lesson_block_ids.count { |id| user_progress[id]&.completed? }
              {
                id: l.id,
                title: l.title,
                lesson_type: l.lesson_type,
                release_day: l.release_day,
                required: l.required,
                available: l.available?(cohort, assignment, lesson_assignments_by_lesson_id[l.id]),
                unlock_date: l.assigned_unlock_date(cohort, assignment, lesson_assignments_by_lesson_id[l.id]),
                total_blocks: lesson_block_ids.size,
                completed_blocks: lesson_completed,
                completed: lesson_completed == lesson_block_ids.size && lesson_block_ids.any?,
                review_status: LessonReviewStatus.for(l, latest_submissions_by_block),
                submission_window: SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: l)
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

        # An older redo must disappear once the student has submitted newer work.
        redo_submissions = latest_submissions.select { |submission| submission.grade == "R" }
          .sort_by { |submission| submission.graded_at || Time.zone.at(0) }
          .reverse
          .first(5)
        action_items = redo_submissions.map { |s|
          lesson = s.content_block.lesson
          submission_window = SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson)
          {
            type: "redo",
            submission_id: s.id,
            content_block_id: s.content_block_id,
            cohort_id: cohort.id,
            lesson_id: lesson.id,
            lesson_title: lesson.title,
            content_block_title: s.content_block.display_title(fallback: "Exercise"),
            feedback: s.feedback,
            submission_window: submission_window,
            submissions_closed: submission_window[:submissions_closed]
          }
        }

        recently_graded = latest_submissions
          .select { |submission| submission.grade.present? && submission.grade != "R" }
          .sort_by { |submission| submission.graded_at || Time.zone.at(0) }
          .reverse
          .first(5)
          .map do |submission|
            {
              submission_id: submission.id,
              content_block_id: submission.content_block_id,
              cohort_id: cohort.id,
              lesson_id: submission.content_block.lesson.id,
              lesson_title: submission.content_block.lesson.title,
              content_block_title: submission.content_block.display_title(fallback: "Exercise"),
              grade: submission.grade,
              feedback: submission.feedback,
              graded_at: submission.graded_at
            }
          end

        announcement_scope = Announcement.visible_for(current_user)
          .includes(:cohort, :author)
          .where(audience: :cohort, cohort_id: cohort.id)
          .or(Announcement.visible_for(current_user).includes(:cohort, :author).where(audience: :global))
        unread_projection = AnnouncementUnreadProjection.new(current_user, announcement_scope)
        unread_announcement_ids = unread_projection.unread_ids
        visible_announcements = announcement_scope
          .where(pinned: true)
          .or(announcement_scope.where(id: unread_announcement_ids))
          .ordered
          .limit(5)
          .to_a
        announcement_notifications = current_user.notifications
          .where(notifiable_type: "Announcement", notifiable_id: visible_announcements.map(&:id))
          .index_by(&:notifiable_id)

        render json: {
          dashboard: {
            enrolled: true,
            user: user_summary,
            cohort: {
              id: cohort.id,
              name: cohort.name,
              cohort_type: cohort.cohort_type,
              start_date: cohort.start_date,
              status: cohort.status,
              requires_github: cohort.requires_github,
              announcements: visible_announcements.map { |announcement| dashboard_announcement_json(announcement, announcement_notifications[announcement.id]) },
              unread_notifications_count: unread_projection.count
            },
            course_access: {
              course_delivery: cohort.course_delivery,
              access_expires_at: enrollment.access_expires_at,
              support_expires_at: enrollment.support_expires_at
            },
            overall_progress: {
              completed: completed_count,
              total: total_count,
              percentage: overall_percentage
            },
            modules: modules_data,
            continue_lesson: continue_lesson,
            action_items: action_items,
            recently_graded: recently_graded,
            resources: dashboard_resources_json(cohort),
            private_meetings_enabled: cohort.private_meeting_config&.enabled? || false,
            office_hours: OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(cohort), limit: 3)
          }
        }
      end

      def dashboard_resources_json(cohort)
        Array((cohort.settings || {})["class_resources"]).map.with_index do |resource, index|
          {
            id: index + 1,
            title: resource["title"],
            url: resource["url"],
            category: resource["category"] || "general",
            description: resource["description"]
          }
        end
      end

      def dashboard_announcement_json(announcement, notification = nil)
        {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          pinned: announcement.pinned,
          published_at: announcement.published_at,
          cohort_id: announcement.cohort_id,
          cohort_name: announcement.cohort&.name,
          read_at: notification&.read_at,
          unread: notification.present? && !notification.read?,
          author: announcement.author && {
            id: announcement.author.id,
            full_name: announcement.author.full_name,
            email: announcement.author.email
          }
        }
      end

      def render_admin_dashboard
        cohorts_scope = current_user.accessible_cohorts.active.includes(:enrollments, :curriculum)
        cohorts_scope = cohorts_scope.where(id: @selected_cohort.id) if @selected_cohort
        cohorts = cohorts_scope.to_a

        attention = AttentionProjection.new(cohort_ids: cohorts.map(&:id)).call

        if cohorts.empty?
          render json: { dashboard: { user: user_summary, cohorts: [], attention: attention.except(:enrollments) } }
          return
        end

        cohorts_data = cohorts.map do |cohort|
          build_cohort_dashboard(cohort, attention)
        end

        # For backward compatibility, also include the first cohort's data
        # at the top level so existing frontend code keeps working
        primary = cohorts_data.first

        render json: {
          dashboard: {
            user: user_summary,
            attention: attention.except(:enrollments),
            cohort: primary[:cohort],
            students: primary[:students],
            ungraded_count: primary[:ungraded_count],
            cohorts: cohorts_data
          }
        }
      end

      def build_cohort_dashboard(cohort, attention)
        students = attention[:enrollments].select { |row| row[:cohort_id] == cohort.id }
        ungraded_count = students.sum { |row| row[:ungraded_count] }

        {
          cohort: {
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            status: cohort.status,
            enrolled_count: cohort.enrollments.joins(:user).merge(User.not_archived).size,
            active_count: students.size,
            students_without_modules_count: cohort.active? ? students.count { |row| row[:total_blocks].zero? } : 0
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
