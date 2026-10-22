module Api
  module V1
    class ActivityEventsController < ApplicationController
      CATEGORIES = {
        "account" => %w[account_signed_in],
        "learning" => %w[checkpoint_completed checkpoint_reopened video_started video_completed recording_started recording_completed],
        "work" => %w[submission_created submission_updated submission_graded]
      }.freeze

      before_action :authenticate_user!

      # GET /api/v1/activity_events?user_id=...&cohort_id=...&before_id=...
      def index
        subject = if params[:user_id].present?
          User.find(params[:user_id])
        else
          current_user
        end
        unless current_user.admin? || subject.id == current_user.id ||
            (current_user.instructor? && subject.student? && subject.enrollments.where(cohort_id: current_user.accessible_cohorts.select(:id)).exists?)
          render_forbidden("Cannot view this activity")
          return
        end

        scope = ActivityEvent.where(subject_user: subject)
        if params[:cohort_id].present?
          cohort_id = params[:cohort_id].to_i
          unless cohort_id.positive? && subject.enrollments.exists?(cohort_id: cohort_id)
            render json: { error: "Student is not enrolled in this cohort" }, status: :not_found
            return
          end
          if current_user.instructor? && !current_user.can_teach_cohort?(Cohort.find(cohort_id))
            render_forbidden("Cannot access this cohort")
            return
          end
          scope = scope.where(cohort_id: cohort_id)
        elsif current_user.instructor? && subject.id != current_user.id
          scope = scope.where(cohort_id: current_user.accessible_cohorts.select(:id))
        end
        if params[:event_type].present?
          unless ActivityEvent::TYPES.include?(params[:event_type])
            render json: { error: "Invalid event type" }, status: :unprocessable_entity
            return
          end
          scope = scope.where(event_type: params[:event_type])
        end
        if params[:category].present?
          unless CATEGORIES.key?(params[:category])
            render json: { error: "Invalid activity category" }, status: :unprocessable_entity
            return
          end
          scope = scope.where(event_type: CATEGORIES.fetch(params[:category]))
        end
        scope = scope.where("activity_events.id < ?", params[:before_id].to_i) if params[:before_id].to_i.positive?

        limit = params[:limit].to_i.clamp(1, 100)
        limit = 40 if params[:limit].blank?
        rows = scope.includes(:actor, :cohort, :subject_user).order(id: :desc).limit(limit + 1).to_a
        has_more = rows.length > limit
        rows = rows.first(limit)
        records = records_for(rows)

        render json: {
          activity_events: rows.map { |event|
            {
              id: event.id,
              event_type: event.event_type,
              actor: { id: event.actor_id, name: event.actor.full_name, role: event.actor.role },
              subject_user_id: event.subject_user_id,
              cohort_id: event.cohort_id,
              cohort_name: event.cohort&.name,
              record_type: event.record_type,
              record_id: event.record_id,
              record_label: record_label(records[[ event.record_type, event.record_id ]]),
              destination: destination_for(event, records[[ event.record_type, event.record_id ]]),
              evidence: event.evidence,
              created_at: event.created_at
            }
          },
          next_before_id: has_more ? rows.last.id : nil
        }
      end

      private

      # Batch record loading; labels remain part of personal history even when a
      # record is no longer navigable. Destinations require current access.
      def records_for(rows)
        records = {}
        { "ContentBlock" => ContentBlock.includes(lesson: :curriculum_module),
          "Recording" => Recording.all,
          "Submission" => Submission.includes(:enrollment, content_block: { lesson: :curriculum_module }) }.each do |type, scope|
          ids = rows.filter_map { |event| event.record_id if event.record_type == type }
          scope.where(id: ids).each { |record| records[[ type, record.id ]] = record }
        end
        records
      end

      def record_label(record)
        record.is_a?(Submission) ? record.content_block.display_title(fallback: "Exercise") : record&.title
      end

      def destination_for(event, record)
        return if event.event_type == "account_signed_in" || record.nil?

        cohort = event.cohort || (record.enrollment&.cohort if record.is_a?(Submission))
        return unless cohort
        if current_user.staff?
          @teachable_cohorts ||= {}
          return unless @teachable_cohorts.fetch(cohort.id) { @teachable_cohorts[cohort.id] = current_user.can_teach_cohort?(cohort) }
        else
          return unless current_user.id == event.subject_user_id
        end
        enrollment = unless current_user.staff?
          @read_enrollments ||= {}
          key = [ event.subject_user_id, cohort.id ]
          @read_enrollments.fetch(key) { @read_enrollments[key] = event.subject_user.enrollments.with_read_access.find_by(cohort: cohort) }
        end
        return unless current_user.staff? || enrollment

        context = { cohort_id: cohort.id, student_id: event.subject_user_id }
        case record
        when Submission
          return unless record.user_id == event.subject_user_id && record.enrollment&.cohort_id == cohort.id
          return context.merge(kind: "submission", submission_id: record.id) if current_user.staff?

          block = record.content_block
        when ContentBlock
          block = record
        when Recording
          return unless record.cohort_id == cohort.id && (current_user.staff? || record.published?)

          return context.merge(kind: "recording", recording_id: record.id)
        end
        return unless block

        lesson = block.lesson
        return unless lesson.curriculum_module.curriculum_id == cohort.curriculum_id
        unless current_user.staff?
          assignment = enrollment.module_assignments.find_by(module_id: lesson.module_id)
          lesson_assignment = enrollment.lesson_assignments.find_by(lesson_id: lesson.id)
          return unless assignment&.accessible?(cohort) || lesson_assignment
          return unless lesson.available?(cohort, assignment, lesson_assignment)
        end
        context.merge(kind: "lesson", lesson_id: lesson.id, content_block_id: block.id)
      end
    end
  end
end
