module Api
  module V1
    class DashboardController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

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

      def dismiss_start_here
        enrollment = current_user.enrollments.with_read_access.find_by!(cohort_id: params.require(:cohort_id))
        enrollment.update!(start_here_dismissed_at: enrollment.start_here_dismissed_at || Time.current)
        render json: { dismissed: true }
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
          enrollment_scope.with_read_access.order(:status)
        end
        enrollment = enrollment_scope.first

        unless enrollment
          render json: { dashboard: { enrolled: false, user: user_summary,
            catalog_enabled: Cohort.active.where(course_delivery: "self_paced", public_checkout_enabled: true).exists?,
            pending_purchases: current_user.course_purchases.where(status: "pending").includes(:cohort).map { |purchase|
              { id: purchase.id, cohort_id: purchase.cohort_id, course_name: purchase.cohort.public_title.presence || "Self-paced course" }
            } } }
          return
        end
        enrollment.mark_joined! if enrollment.active?

        enrollment.record_first_course_open! if enrollment.active?

        cohort = enrollment.cohort
        content = AssignedLearningContent.new(enrollment)
        progress = LearnerProgress.new(enrollment, content: content)
        assignments_by_module_id = content.module_assignments
        lesson_assignments_by_lesson_id = content.lesson_assignments
        overall = progress.overall
        latest_submissions = progress.latest_submissions.values

        modules_data = content.modules.map do |mod|
          assignment = assignments_by_module_id[mod.id]
          module_progress = progress.module_progress(mod)

          {
            id: mod.id,
            name: mod.name,
            module_type: mod.module_type,
            position: mod.position,
            total_blocks: module_progress.total_blocks,
            completed_blocks: module_progress.completed_blocks,
            progress_percentage: module_progress.progress_percentage,
            **progress.module_lesson_counts(mod),
            assigned: assignment.present?,
            unlocked: enrollment.module_reachable_for_read?(assignment) || false,
            available: module_progress.lessons.any?(&:available),
            unlock_date: assignment&.next_unlock_date(cohort),
            lessons: module_progress.lessons.map { |entry|
              l = entry.lesson
              {
                id: l.id,
                title: l.title,
                lesson_type: l.lesson_type,
                kind: LessonKind.for(l),
                added_at: l.created_at,
                release_day: l.release_day,
                required: entry.required,
                available: entry.available,
                unlock_date: l.assigned_unlock_date(cohort, assignment, lesson_assignments_by_lesson_id[l.id]),
                total_blocks: entry.total_blocks,
                completed_blocks: entry.completed_blocks,
                completed: entry.completed,
                learner_status: entry.status,
                review_status: entry.review_status,
                submission_window: entry.submission_window
              }
            }
          }
        end

        # Personal milestones and shared requirements share one next step (LearnerProgress).
        personal_plan = LearningPlanProjection.new(enrollment, progress: progress).call if progress.plan
        next_lesson = progress.next_lesson
        continue_lesson = next_lesson && { id: next_lesson.id, title: next_lesson.title }

        # An older redo must disappear once the student has submitted newer work.
        action_items = progress.redo_submissions.first(5).map { |s|
          lesson = s.content_block.lesson
          submission_window = SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson, enrollment: enrollment)
          {
            type: "redo",
            submission_id: s.id,
            content_block_id: s.content_block_id,
            submission_type: s.content_block.submission_type_for(enrollment),
            cohort_id: cohort.id,
            lesson_id: lesson.id,
            lesson_title: lesson.title,
            content_block_title: s.content_block.display_title(fallback: "Exercise"),
            feedback: s.feedback,
            submission_window: submission_window,
            submissions_closed: submission_window[:submissions_closed]
          }
        }

        # A Redo on work that is not reviewed is past feedback, so it reads here
        # with the other grades rather than as work to redo.
        historical = progress.historical_redo_submissions.to_set
        recently_graded = latest_submissions
          .select { |submission| submission.grade.present? && (submission.grade != "R" || historical.include?(submission)) }
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

        dashboard = {
          enrolled: true,
          start_here: cohort.self_paced? && enrollment.active? && enrollment.start_here_dismissed_at.nil?,
          review_response_time: cohort.effective_review_response_time,
          enrollment_status: enrollment.status,
          support_instructor_id: EnrollmentCapabilities.for(enrollment)[:support_instructor_id] || enrollment.cohort.instructors.not_archived.order(:id).first&.id,
          paused_since: enrollment.pause_date,
          capabilities: EnrollmentCapabilities.for(enrollment),
          user: user_summary,
          cohort: {
            features: FeatureSwitches.for_client(FeatureSwitches.for(cohort: cohort)),
            id: cohort.id,
            name: cohort.name,
            cohort_type: cohort.cohort_type,
            start_date: cohort.start_date,
            status: cohort.effective_status,
            requires_github: cohort.requires_github && FeatureSwitches.for(cohort: cohort)["github_sync"],
            announcements: (FeatureSwitches.for(cohort: cohort)["announcements"] ? visible_announcements : []).map { |announcement| dashboard_announcement_json(announcement, announcement_notifications[announcement.id]) },
            unread_notifications_count: unread_projection.count
          },
          course_access: {
            course_delivery: cohort.course_delivery,
            access_expires_at: enrollment.access_expires_at,
            support_weeks: enrollment.self_paced_support_weeks || cohort.self_paced_support_weeks,
            support_expires_at: enrollment.support_expires_at
          },
          personal_plan: personal_plan,
          overall_progress: overall,
          modules: modules_data,
          continue_lesson: continue_lesson,
          action_items: action_items,
          recently_graded: recently_graded,
          resources: dashboard_resources_json(cohort, enrollment),
          private_meetings_enabled: FeatureSwitches.for(cohort: cohort)["private_meetings"] && (cohort.private_meeting_config&.enabled? || false),
          office_hours: FeatureSwitches.for(cohort: cohort)["office_hours"] ? OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(cohort), limit: 3, optional_check_ins: cohort.optional_guided_check_ins?) : []
        }
        # The redesigned Today (W8 PR 8.2) only for a cohort with the new student
        # experience explicitly on; every other cohort's payload is unchanged.
        features = FeatureSwitches.for(cohort: cohort)
        if features["student_experience_v2"] == true
          dashboard[:student_today] = StudentToday.new(enrollment, progress: progress, features: features).call
        else
          dashboard.merge!(CourseCompletion.learner_summary(enrollment, progress: progress, features: features))
        end
        render json: { dashboard: dashboard }
      end

      def dashboard_resources_json(cohort, enrollment)
        cohort.class_resources_for_read(enrollment).map.with_index do |resource, index|
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
        cohorts_scope = current_user.accessible_cohorts.active.includes(:curriculum)
        cohorts_scope = cohorts_scope.where(id: @selected_cohort.id) if @selected_cohort
        cohorts = cohorts_scope.to_a

        attention = AttentionProjection.new(cohort_ids: cohorts.map(&:id)).call
        today = InstructorToday.new(user: current_user, cohorts: cohorts, attention: attention, scoped: @selected_cohort.present?).call
        @school_features = FeatureSwitches.school

        if cohorts.empty?
          render json: { dashboard: { user: user_summary, cohorts: [], today: today, attention: attention.except(:enrollments) } }
          return
        end

        enrolled_counts = Enrollment.joins(:user).merge(User.not_archived).where(cohort_id: cohorts.map(&:id)).group(:cohort_id).count
        cohorts_data = cohorts.map do |cohort|
          build_cohort_dashboard(cohort, attention, enrolled_count: enrolled_counts.fetch(cohort.id, 0))
        end

        # For backward compatibility, also include the first cohort's data
        # at the top level so existing frontend code keeps working
        primary = cohorts_data.first

        render json: {
          dashboard: {
            user: user_summary,
            attention: attention.except(:enrollments),
            today: today,
            cohort: primary[:cohort],
            students: primary[:students],
            ungraded_count: primary[:ungraded_count],
            cohorts: cohorts_data
          }
        }
      end

      def build_cohort_dashboard(cohort, attention, enrolled_count:)
        students = attention[:enrollments].select { |row| row[:cohort_id] == cohort.id }
        ungraded_count = students.sum { |row| row[:ungraded_count] }

        {
          cohort: {
            features: FeatureSwitches.for_client(FeatureSwitches.for(cohort: cohort, school: @school_features)),
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            status: cohort.effective_status,
            enrolled_count: enrolled_count,
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
