module PrivateMeetingErrorHandling
  extend ActiveSupport::Concern

  included do
    rescue_from PrivateMeetingScheduler::InvalidRequest do |error|
      render json: { error: error.message }, status: :unprocessable_entity
    end
    rescue_from PrivateMeetingScheduler::Conflict do |error|
      render json: { error: error.message }, status: :conflict
    end
    rescue_from ActiveRecord::RecordInvalid do |error|
      render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
    end
    rescue_from ActiveRecord::RecordNotUnique, ActiveRecord::StatementInvalid do |error|
      raise error unless error.cause.is_a?(PG::UniqueViolation) || error.cause.is_a?(PG::ExclusionViolation)

      render json: { error: "That time is no longer available. Refresh and choose another." }, status: :conflict
    end
  end
end
