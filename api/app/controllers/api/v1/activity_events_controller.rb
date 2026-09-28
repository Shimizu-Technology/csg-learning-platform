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
        rows = scope.includes(:actor, :cohort).order(id: :desc).limit(limit + 1).to_a
        has_more = rows.length > limit
        rows = rows.first(limit)
        labels = labels_for(rows)

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
              record_label: labels[[ event.record_type, event.record_id ]],
              evidence: event.evidence,
              created_at: event.created_at
            }
          },
          next_before_id: has_more ? rows.last.id : nil
        }
      end

      private

      def labels_for(rows)
        labels = {}
        block_ids = rows.filter_map { |event| event.record_id if event.record_type == "ContentBlock" }
        ContentBlock.where(id: block_ids).pluck(:id, :title).each { |id, title| labels[[ "ContentBlock", id ]] = title }
        recording_ids = rows.filter_map { |event| event.record_id if event.record_type == "Recording" }
        Recording.where(id: recording_ids).pluck(:id, :title).each { |id, title| labels[[ "Recording", id ]] = title }
        submission_ids = rows.filter_map { |event| event.record_id if event.record_type == "Submission" }
        Submission.includes(:content_block).where(id: submission_ids).each do |submission|
          labels[[ "Submission", submission.id ]] = submission.content_block.title
        end
        labels
      end
    end
  end
end
