module Api
  module V1
    class GithubRepositoryBindingsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_enrollment!
      rescue_from ActiveRecord::RecordNotFound, with: :not_found
      rescue_from ActiveRecord::RecordInvalid do |error|
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      rescue_from ActiveRecord::RecordNotUnique do
        render json: { error: "Repository binding changed while saving. Reload and try again." }, status: :conflict
      end

      def index
        rows = @enrollment.github_repository_bindings.order(:id)
        # Bindings belong to this one learner; serializer identity reads are
        # constant even when many module bindings exist.
        rows.each { |row| row.enrollment = @enrollment }
        render json: { bindings: rows.map { |row| GithubAppSerializer.binding(row) },
          github_identity: GithubAppSerializer.identity(@enrollment.user), can_connect_github: current_user.id == @enrollment.user_id && GithubAppCredentials.oauth_configured?,
          installations: available_installations.order(:id).map { |row| { id: row.id, account_login: row.account_login, connection_state: row.connection_state } },
          modules: @enrollment.cohort.curriculum.modules.order(:position).map { |mod| { id: mod.id, name: mod.name } } }
      end

      def create
        binding = @enrollment.with_learning_write_guard(request_started_at: @learning_request_started_at) do
          # The guard waits for a curriculum copy and reloads the enrollment.
          # Resolve module membership against its current cohort only afterwards.
          raise ActiveRecord::RecordNotFound unless GithubRepositoryAccess.enabled?(@enrollment.cohort) && @enrollment.active?
          installation = available_installations.find(record_id!(:github_app_installation_id))
          mod = @enrollment.cohort.curriculum.modules.find(record_id!(:curriculum_module_id)) if params[:curriculum_module_id].present?
          binding = @enrollment.github_repository_bindings.find_or_initialize_by(curriculum_module_id: mod&.id)
          name = params[:full_name].to_s.strip
          # An explicit rebind resets numeric provenance. Existing URL submissions
          # are never turned into verified bindings by migration or inference.
          binding.update!(github_app_installation: installation, full_name: name, repository_id: nil, github_user_id: nil, github_username: nil, verification_state: "pending", failure_reason: nil, verified_at: nil, checked_at: nil)
          binding
        end
        render json: { binding: GithubAppSerializer.binding(binding) }
      end

      def verify
        binding = @enrollment.github_repository_bindings.find(params[:id])
        binding.enrollment = @enrollment
        begin
          GithubRepositoryAccess.new(binding).verify!
        rescue GithubAppClient::Error
          # Persisted failure is a recoverable verification result, not success.
        end
        render json: { binding: GithubAppSerializer.binding(binding) }
      end

      private

      def available_installations
        scope = @enrollment.cohort.github_app_installations
        user = @enrollment.user
        user.github_identity_verified? ? scope.where(account_type: "User", account_id: user.github_user_id) : scope.none
      end

      def record_id!(key)
        value = params[key]
        raise ActiveRecord::RecordNotFound unless value.to_s.match?(/\A[1-9]\d{0,18}\z/) && value.to_i <= 9_223_372_036_854_775_807

        value.to_i
      end

      def set_enrollment!
        scope = StaffCohortScope.new(current_user)
        rows = scope.admin? ? Enrollment.where(cohort_id: scope.visible_cohorts.select(:id)) : current_user.enrollments
        @enrollment = rows.includes(:user, cohort: :curriculum).find(params[:enrollment_id])
        # Instructors have no setup/verification privilege, even for their own
        # staff enrollment. Learners manage only their own active enrollment.
        raise ActiveRecord::RecordNotFound unless scope.admin? || current_user.student?
        raise ActiveRecord::RecordNotFound unless GithubRepositoryAccess.enabled?(@enrollment.cohort)
        raise ActiveRecord::RecordNotFound unless @enrollment.active? && !@enrollment.user.archived? && !@enrollment.user.invite_pending?
      end

      def not_found
        render json: { error: "Not found" }, status: :not_found
      end
    end
  end
end
