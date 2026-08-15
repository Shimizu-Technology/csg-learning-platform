class ReadinessController < ActionController::API
  def show
    checks = { database: database_status }
    return render_unavailable(checks) unless checks[:database] == "ok"

    checks[:queue] = QueueReadiness.status
    return render_unavailable(checks) if checks[:queue] == "failed"

    response.set_header("Cache-Control", "no-store")
    render json: { status: "ok", checks: checks }
  end

  private

  def database_status
    ActiveRecord::Base.connection.select_value("SELECT 1")
    "ok"
  rescue StandardError => error
    log_failure("database", error)
    "failed"
  end

  def render_unavailable(checks)
    response.set_header("Cache-Control", "no-store")
    render json: { status: "unavailable", checks: checks }, status: :service_unavailable
  end

  def log_failure(check, error)
    Rails.logger.error(
      "[Readiness] check_failed check=#{check} error_class=#{error.class.name}"
    )
  end
end
