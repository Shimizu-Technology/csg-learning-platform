module Api
  module V1
    class ActivityEventsController < ApplicationController
      CATEGORIES = {
        "account" => %w[account_signed_in],
        "learning" => %w[checkpoint_completed checkpoint_reopened video_started video_completed recording_started recording_completed],
        "work" => %w[submission_created submission_updated submission_graded]
      }.freeze

      before_action :authenticate_user!
      before_action :validate_activity_filters!

      # GET /api/v1/activity_events (personal history unless feed is explicit)
      def index
        scope = authorized_activity_scope
        return if performed?

        # The recording boundary belongs to the authorized feed, not its current
        # learner/actor/date/category filters or page. No synthetic backfill.
        recorded_since = scope.minimum(:created_at)
        scope = filtered_activity_scope(scope)
        return if performed?

        limit = @filters.fetch(:limit, 40)
        rows = scope.includes(:actor, :subject_user, cohort: :cohort_module_schedules).order(id: :desc).limit(limit + 1).to_a
        has_more = rows.length > limit
        rows = rows.first(limit)
        records = records_for(rows)
        preload_learning_access(rows, records)

        render json: {
          activity_events: rows.map { |event|
            {
              id: event.id,
              event_type: event.event_type,
              actor: { id: event.actor_id, name: event.actor.full_name, role: event.actor.role },
              subject_user_id: event.subject_user_id,
              subject_user: { id: event.subject_user_id, name: event.subject_user.full_name, role: event.subject_user.role },
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
          next_before_id: has_more ? rows.last.id : nil,
          recorded_since: recorded_since&.iso8601(6)
        }
      end

      private

      def validate_activity_filters!
        @filters = {}
        { feed: %w[cohort school], category: CATEGORIES.keys, event_type: ActivityEvent::TYPES }.each do |key, allowed|
          next unless params.key?(key)
          next if params[:feed].blank? && key != :feed && params[key].blank?
          return invalid_activity_filter!("Invalid #{key}") unless allowed.include?(params[key])

          @filters[key] = params[key]
        end
        %i[user_id actor_id cohort_id before_id limit].each do |key|
          next unless params.key?(key)
          value = params[key]
          # Existing personal clients use blank optional filters and clamped
          # page sizes. Keep those semantics; collection feeds are strict.
          if params[:feed].blank?
            next if value.blank?
            if key == :limit
              @filters[key] = value.to_i.clamp(1, 100)
              next
            elsif key == :before_id
              @filters[key] = value.to_i if value.to_i.positive?
              next
            end
          end
          maximum = key == :limit ? 100 : 9_223_372_036_854_775_807
          unless value.is_a?(String) && value.match?(/\A[1-9][0-9]*\z/) && value.length <= 19 && value.to_i <= maximum
            return invalid_activity_filter!("#{key} must be a positive integer up to #{maximum}")
          end
          @filters[key] = value.to_i
        end
        %i[since until].each do |key|
          next unless params.key?(key)
          value = params[key]
          unless value.is_a?(String) && value.match?(/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/) && !value.start_with?("0000-")
            return invalid_activity_filter!("#{key} must be an ISO date (YYYY-MM-DD)")
          end
          @filters[key] = Date.iso8601(value)
        end
        if @filters[:since] && @filters[:until] && @filters[:since] > @filters[:until]
          return invalid_activity_filter!("since must be on or before until")
        end
        if @filters[:feed] == "cohort" && !@filters[:cohort_id]
          invalid_activity_filter!("cohort_id is required for the cohort feed")
        end
      rescue Date::Error
        invalid_activity_filter!("since and until must be valid ISO dates (YYYY-MM-DD)")
      end

      def invalid_activity_filter!(message)
        render json: { error: message }, status: :unprocessable_entity
      end

      def authorized_activity_scope
        case @filters[:feed]
        when "school"
          require_admin!
          ActivityEvent.all unless performed?
        when "cohort"
          cohort = Cohort.find(@filters[:cohort_id])
          return unless require_cohort_access!(cohort, teacher: true)

          ActivityEvent.where(cohort_id: cohort.id)
        else
          personal_activity_scope
        end
      end

      # Preserve the no-feed account-history authorization and cohort semantics.
      def personal_activity_scope
        subject = @filters[:user_id] ? User.find(@filters[:user_id]) : current_user
        unless current_user.admin? || subject.id == current_user.id ||
            (current_user.instructor? && subject.student? && subject.enrollments.where(cohort_id: current_user.accessible_cohorts.select(:id)).exists?)
          render_forbidden("Cannot view this activity")
          return
        end

        scope = ActivityEvent.where(subject_user: subject)
        if @filters[:cohort_id]
          unless subject.enrollments.exists?(cohort_id: @filters[:cohort_id])
            render json: { error: "Student is not enrolled in this cohort" }, status: :not_found
            return
          end
          if current_user.instructor? && !current_user.can_teach_cohort?(Cohort.find(@filters[:cohort_id]))
            render_forbidden("Cannot access this cohort")
            return
          end
          scope = scope.where(cohort_id: @filters[:cohort_id])
        elsif current_user.instructor? && subject.id != current_user.id
          scope = scope.where(cohort_id: current_user.accessible_cohorts.select(:id))
        end
        scope
      end

      def filtered_activity_scope(scope)
        if @filters[:feed] && @filters[:user_id]
          learner = User.find(@filters[:user_id])
          unless learner.student?
            invalid_activity_filter!("user_id must identify a learner")
            return
          end
          scope = scope.where(subject_user_id: learner.id)
        end
        if @filters[:feed] == "school" && @filters[:cohort_id]
          scope = scope.where(cohort_id: Cohort.find(@filters[:cohort_id]).id)
        end
        scope = scope.where(actor_id: @filters[:actor_id]) if @filters[:actor_id]
        scope = scope.where(event_type: @filters[:event_type]) if @filters[:event_type]
        scope = scope.where(event_type: CATEGORIES.fetch(@filters[:category])) if @filters[:category]
        scope = scope.where("activity_events.created_at >= ?", @filters[:since].in_time_zone(LearningCalendar::TIMEZONE)) if @filters[:since]
        scope = scope.where("activity_events.created_at < ?", (@filters[:until] + 1).in_time_zone(LearningCalendar::TIMEZONE)) if @filters[:until]
        scope = scope.where("activity_events.id < ?", @filters[:before_id]) if @filters[:before_id]
        scope
      end

      # Batch record loading; labels remain part of personal history even when a
      # record is no longer navigable. Destinations require current access.
      def records_for(rows)
        records = {}
        { "ContentBlock" => ContentBlock.includes(lesson: :curriculum_module),
          "Recording" => Recording.all,
          "Submission" => Submission.includes({ enrollment: { cohort: :cohort_module_schedules } }, content_block: { lesson: :curriculum_module }) }.each do |type, scope|
          ids = rows.filter_map { |event| event.record_id if event.record_type == type }
          scope.where(id: ids).each { |record| records[[ type, record.id ]] = record }
        end
        records
      end

      def preload_learning_access(rows, records)
        return if current_user.staff?

        @read_enrollments = current_user.enrollments.with_read_access
          .where(cohort_id: (rows.filter_map(&:cohort_id) + records.values.grep(Submission).filter_map { |record| record.enrollment&.cohort_id }).uniq)
          .includes(module_assignments: :curriculum_module, lesson_assignments: [])
          .index_by(&:cohort_id)
        @module_assignments = @read_enrollments.transform_values { |enrollment| enrollment.module_assignments.index_by(&:module_id) }
        @lesson_assignments = @read_enrollments.transform_values { |enrollment| enrollment.lesson_assignments.index_by(&:lesson_id) }
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
        enrollment = @read_enrollments[cohort.id] unless current_user.staff?
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

          return context.merge(kind: "recording", recording_id: record.id, destination_path: LearningDestination.recording(recording_id: record.id, cohort_id: cohort.id))
        end
        return unless block

        lesson = block.lesson
        return unless lesson.curriculum_module.curriculum_id == cohort.curriculum_id
        unless current_user.staff?
          assignment = @module_assignments[cohort.id][lesson.module_id]
          lesson_assignment = @lesson_assignments[cohort.id][lesson.id]
          return unless assignment&.accessible?(cohort) || lesson_assignment
          return unless lesson.available?(cohort, assignment, lesson_assignment)
        end
        context.merge(kind: "lesson", lesson_id: lesson.id, content_block_id: block.id,
          destination_path: LearningDestination.lesson(lesson_id: lesson.id, cohort_id: cohort.id, block_id: block.id))
      end
    end
  end
end
