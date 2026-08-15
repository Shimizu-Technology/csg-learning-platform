class HealthController < ActionController::API
  def show
    response.set_header("Cache-Control", "no-store")
    render json: { status: "ok" }
  end
end
