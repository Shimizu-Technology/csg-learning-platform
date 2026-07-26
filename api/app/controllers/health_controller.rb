class HealthController < ActionController::API
  def show
    ActiveRecord::Base.connection.select_value("SELECT 1")

    response.set_header("Cache-Control", "no-store")
    render json: {
      status: "ok",
      checks: { database: "ok" }
    }
  rescue StandardError => error
    Rails.logger.error(
      "[Readiness] check_failed check=database error_class=#{error.class.name}"
    )
    response.set_header("Cache-Control", "no-store")
    render json: {
      status: "unavailable",
      checks: { database: "failed" }
    }, status: :service_unavailable
  end
end
