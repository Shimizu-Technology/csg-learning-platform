module Api
  module V1
    class LearningPlansController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_enrollment

      def show
        render json: management_json
      end

      def update
        with_learning_write_guard(@enrollment) do
          plan = @enrollment.learning_plan || @enrollment.build_learning_plan
          requested = plan_params
          if plan.persisted? && (!requested.key?(:lock_version) || requested[:lock_version].to_s != plan.lock_version.to_s)
            render_stale_resource("Learning plan")
            return
          end
          if plan.new_record? && requested[:lock_version].present?
            render_stale_resource("Learning plan")
            return
          end
          plan.assign_attributes(requested.except(:lock_version))
          changed = plan.new_record? || plan.changed?
          plan.save!
          plan.revisions.create!(author: current_user, snapshot: plan.snapshot) if changed
        end
        render json: management_json
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue ActiveRecord::StaleObjectError, ActiveRecord::RecordNotUnique
        render_stale_resource("Learning plan")
      end

      private

      def set_enrollment
        @enrollment = Enrollment.includes(:user, cohort: :curriculum).find(params[:enrollment_id])
        require_cohort_access!(@enrollment.cohort, teacher: true)
      end

      def plan_params
        params.require(:learning_plan).permit(:active, :title, :description, :target_date, :next_check_in_on, :lock_version,
          milestones: [ :title, :due_on, { lesson_ids: [] } ], lesson_overrides: [ :lesson_id, :required, :reason ])
      end

      def management_json
        plan = @enrollment.reload.learning_plan
        content = AssignedLearningContent.new(@enrollment)
        {
          learning_plan: plan && plan.snapshot.merge(id: plan.id, lock_version: plan.lock_version, updated_at: plan.updated_at.iso8601(6)),
          lessons: content.modules.flat_map do |mod|
            content.lessons_for(mod).map { |lesson| { id: lesson.id, title: lesson.title, module_name: mod.name, standard_required: lesson.required? } }
          end,
          revisions: plan ? plan.revisions.includes(:author).order(id: :desc).limit(20).map { |revision|
            { id: revision.id, author: revision.author.full_name, created_at: revision.created_at, snapshot: revision.snapshot }
          } : []
        }
      end
    end
  end
end
