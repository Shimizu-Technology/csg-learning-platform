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

        attrs, type_errors = validated_policy_params
        if type_errors.any?
          render json: { errors: type_errors }, status: :unprocessable_entity
          return
        end

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

      # Validate raw array/string types BEFORE Strong Parameters so invalid nested
      # hashes, scalars, or non-string array items return 422 instead of being
      # silently dropped or coerced back to defaults.
      def validated_policy_params
        source = params[:check_policy].is_a?(ActionController::Parameters) ? params[:check_policy] : params
        raw = source.to_unsafe_h
        errors = []

        if !raw.key?("required_checks") || !string_array?(raw["required_checks"])
          errors << "Required checks must be an array of strings"
        end
        if raw.key?("allowed_app_slugs") && !raw["allowed_app_slugs"].nil? && !string_array?(raw["allowed_app_slugs"])
          errors << "Allowed app slugs must be an array of strings"
        end
        %w[allowed_branch expected_workflow_path expected_workflow_sha].each do |field|
          if raw.key?(field) && !raw[field].nil? && !raw[field].is_a?(String)
            errors << "#{field.humanize} must be a string"
          end
        end
        return [ {}, errors ] if errors.any?

        attrs = {
          required_checks: raw["required_checks"].dup,
          allowed_branch: raw["allowed_branch"],
          expected_workflow_path: raw["expected_workflow_path"],
          expected_workflow_sha: raw["expected_workflow_sha"]
        }
        attrs[:allowed_app_slugs] = raw["allowed_app_slugs"]&.dup if raw.key?("allowed_app_slugs")
        [ attrs, [] ]
      end

      def string_array?(value)
        value.is_a?(Array) && value.all?(String)
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
