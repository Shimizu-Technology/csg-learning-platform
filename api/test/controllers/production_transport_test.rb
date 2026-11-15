require "test_helper"
require Rails.root.join("lib/production_transport")

class ProductionTransportTest < ActiveSupport::TestCase
  setup do
    @app = ->(_env) { [ 200, { "content-type" => "application/json", "set-cookie" => "probe=synthetic" }, [ '{"ok":true}' ] ] }
    @ssl = ActionDispatch::SSL.new(@app, **ProductionTransport::SSL_OPTIONS)
    @production = ActionDispatch::AssumeSSL.new(@ssl)
  end

  test "forwarded HTTPS has HSTS and secure cookies without redirect" do
    env = Rack::MockRequest.env_for("http://learn-api.example.test/api/v1/profile", "HTTP_X_FORWARDED_PROTO" => "https")
    status, headers, = @production.call(env)
    assert_equal 200, status
    assert_nil headers["location"]
    assert_equal "max-age=31556952", headers["strict-transport-security"]
    assert_includes Array(headers["set-cookie"]).join, "; secure"
    # SSL also recognizes the forwarded scheme without AssumeSSL.
    assert_equal 200, @ssl.call(Rack::MockRequest.env_for("http://example.test/api/v1/profile", "HTTP_X_FORWARDED_PROTO" => "https")).first
  end

  test "remote IP strips private proxies and ignores a forged leftmost address" do
    app = ActionDispatch::RemoteIp.new(->(env) {
      [ 200, {}, [ ActionDispatch::Request.new(env).remote_ip ] ]
    }, true, ActionDispatch::RemoteIp::TRUSTED_PROXIES)
    env = Rack::MockRequest.env_for("http://example.test/", "REMOTE_ADDR" => "10.0.0.2",
      "HTTP_X_FORWARDED_FOR" => "203.0.113.99, 198.51.100.10, 10.0.0.1")
    assert_equal [ "198.51.100.10" ], app.call(env).last
  end

  test "proxy HTTP internal hop is assumed HTTPS without redirect loop" do
    assert_equal 200, @production.call(Rack::MockRequest.env_for("http://example.test/api/v1/profile")).first
  end

  test "SSL alone redirects HTTP except both health paths" do
    assert_equal 301, @ssl.call(Rack::MockRequest.env_for("http://example.test/api/v1/profile")).first
    [ "/health", "/up" ].each do |path|
      assert_equal 200, @ssl.call(Rack::MockRequest.env_for("http://example.test#{path}")).first
      assert_equal 200, @production.call(Rack::MockRequest.env_for("http://example.test#{path}")).first
    end
  end
end
