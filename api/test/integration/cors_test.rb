require "test_helper"

class CorsTest < ActionDispatch::IntegrationTest
  test "cross-origin responses let the web app read a download's filename" do
    origin = ENV.fetch("ALLOWED_ORIGINS", ENV.fetch("FRONTEND_URL", "http://localhost:5173")).split(",").first.strip
    get "/up", headers: { "Origin" => origin }
    assert_equal origin, response.headers["Access-Control-Allow-Origin"]
    assert_includes response.headers["Access-Control-Expose-Headers"].to_s.split(/,\s*/), "Content-Disposition"
  end
end
