module Api
  module V1
    class ExerciseCheckPoliciesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!
      include LessonEditAuthorization
      before_action :set_content_block
      before_action -> { require_lesson_edit_access!(curriculum) }, only: [ :update, :destroy ]

      # GET /api/v1/content_blocks/:content_block_id/check_policy
      def show
        render json: policy_payload
      end

      # PUT /api/v1/content_blocks/:content_block_id/check_policy
      def update
        unless @content_block.exercise_like?
          render json: { errors: [ "Check policies can only be configured on exercise or code challenge blocks" ] }, status: :unprocessable_entity
          return
        end

        attrs = policy_params
        created = nil
        ApplicationRecord.transaction do
          recheck_lesson_edit_access!(curriculum)
          @content_block.lesson.with_authoring_lock do
            created = ExerciseCheckPolicy.create_version!(
              content_block: @content_block,
              required_checks: attrs[:required_checks],
              allowed_app_slugs: attrs.key?(:allowed_app_slugs) ? attrs[:allowed_app_slugs] : nil,
              allowed_branch: attrs[:allowed_branch],
              expected_workflow_path: attrs[:expected_workflow_path],
              expected_workflow_sha: attrs[:expected_workflow_sha],
              created_by: current_user
            )
          end
        end
        return if performed?

        render json: policy_payload(active: created)
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # DELETE /api/v1/content_blocks/:content_block_id/check_policy
      def destroy
        ApplicationRecord.transaction do
          recheck_lesson_edit_access!(curriculum)
          @content_block.lesson.with_authoring_lock do
            ExerciseCheckPolicy.deactivate_active!(content_block: @content_block)
          end
        end
        return if performed?

        render json: policy_payload(active: nil)
      end

      private

      def set_content_block
        @content_block = ContentBlock.includes(lesson: { curriculum_module: :curriculum }).find(params[:content_block_id])
      end

      def curriculum
        @content_block.lesson.curriculum_module.curriculum
      end

      def policy_params
        source = params[:check_policy].is_a?(ActionController::Parameters) ? params[:check_policy] : params
        permitted = source.permit(
          :allowed_branch,
          :expected_workflow_path,
          :expected_workflow_sha,
          required_checks: [],
          allowed_app_slugs: []
        ).to_h.symbolize_keys

        # Preserve explicit empty arrays (ActionController::Parameters strips or passes nil if omitted).
        permitted[:required_checks] = [] if source.key?(:required_checks) && source[:required_checks] == []
        permitted[:allowed_app_slugs] = [] if source.key?(:allowed_app_slugs) && source[:allowed_app_slugs] == []
        permitted
      end

      def policy_payload(active: :load)
        versions = @content_block.exercise_check_policies.includes(:created_by).newest_first.to_a
        resolved_active = active == :load ? versions.find(&:active?) : active
        {
          content_block_id: @content_block.id,
          active_policy: resolved_active&.to_staff_json,
          versions: versions.map(&:to_staff_json)
        }
      end
    end
  end
end
