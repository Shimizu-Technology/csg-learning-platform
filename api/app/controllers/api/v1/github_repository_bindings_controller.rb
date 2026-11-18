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

      def index
        rows = @enrollment.github_repository_bindings.order(:id)
        # Bindings belong to this one learner; serializer identity reads are
        # constant even when many module bindings exist.
        rows.each { |row| row.enrollment = @enrollment }
        render json: { bindings: rows.map { |row| GithubAppSerializer.binding(row) },
          installations: @enrollment.cohort.github_app_installations.order(:id).map { |row| { id: row.id, account_login: row.account_login, connection_state: row.connection_state } },
          modules: @enrollment.cohort.curriculum.modules.order(:position).map { |mod| { id: mod.id, name: mod.name } } }
      end

      def create
        installation = @enrollment.cohort.github_app_installations.find(params[:github_app_installation_id])
        mod = @enrollment.cohort.curriculum.modules.find(params[:curriculum_module_id]) if params[:curriculum_module_id].present?
        binding = @enrollment.github_repository_bindings.find_or_initialize_by(curriculum_module_id: mod&.id)
        name = params[:full_name].to_s.strip
        # An explicit rebind resets numeric provenance. Existing URL submissions
        # are never turned into verified bindings by migration or inference.
        binding.update!(github_app_installation: installation, full_name: name, repository_id: nil, github_username: nil, verification_state: "pending", failure_reason: nil, verified_at: nil, checked_at: nil)
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
