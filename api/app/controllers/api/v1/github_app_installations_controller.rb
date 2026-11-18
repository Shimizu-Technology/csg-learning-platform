module Api
  module V1
    class GithubAppInstallationsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_admin_cohort!
      rescue_from ActiveRecord::RecordNotFound, with: :not_found
      rescue_from GithubAppClient::Error do |error|
        render json: { error: error.message }, status: :unprocessable_entity
      end
      rescue_from ActiveRecord::RecordInvalid do |error|
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def index
        render json: { installations: @cohort.github_app_installations.order(:id).map { |row| GithubAppSerializer.installation(row) }, configured: GithubAppCredentials.configured? }
      end

      def prepare
        render json: GithubAppSetup.prepare(actor: current_user, cohort: @cohort)
      end

      def create
        context = GithubAppSetup.context(state: params[:state], actor: current_user)
        raise ActiveRecord::RecordNotFound unless context["cohort_id"] == @cohort.id

        row = GithubAppSetup.connect(cohort: @cohort, installation_id: params[:installation_id])
        render json: { installation: GithubAppSerializer.installation(row), cohort_id: @cohort.id }
      end

      # The authenticated setup callback shares exactly the same state, role,
      # scope and feature checks as manual installation-ID confirmation.
      def callback
        create
      end

      private

      def set_admin_cohort!
        scope = StaffCohortScope.new(current_user)
        raise ActiveRecord::RecordNotFound unless scope.admin?

        cohort_id = action_name == "callback" ? GithubAppSetup.context(state: params[:state], actor: current_user).fetch("cohort_id") : params[:cohort_id]
        @cohort = scope.visible_cohorts.find(cohort_id)
        raise ActiveRecord::RecordNotFound unless GithubRepositoryAccess.enabled?(@cohort)
      end

      def not_found
        render json: { error: "Not found" }, status: :not_found
      end
    end
  end
end
