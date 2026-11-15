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

  test "remote IP strips Cloudflare and Render hops and ignores forged leftmost addresses" do
    app = ActionDispatch::RemoteIp.new(->(env) {
      [ 200, {}, [ ActionDispatch::Request.new(env).remote_ip ] ]
    }, true, ProductionTransport.trusted_proxies({}))
    {
      "202.128.1.9, 172.71.124.5" => "202.128.1.9",
      "203.0.113.66, 202.128.1.9, 104.22.66.10" => "202.128.1.9",
      "104.16.0.1, 202.128.1.9, 172.71.124.5" => "202.128.1.9",
      "202.128.1.9, 162.158.1.1, 172.71.124.5" => "202.128.1.9",
      "2001:db8::5, 2400:cb00::1" => "2001:db8::5",
      "203.0.113.66, 198.51.100.4" => "198.51.100.4"
    }.each do |chain, expected|
      env = Rack::MockRequest.env_for("http://example.test/", "REMOTE_ADDR" => "10.0.0.2", "HTTP_X_FORWARDED_FOR" => chain)
      assert_equal [ expected ], app.call(env).last, chain
    end
  end

  test "published ranges are nonempty valid CIDRs of the expected family" do
    { CloudflareIpRanges::IPV4 => :ipv4?, CloudflareIpRanges::IPV6 => :ipv6? }.each do |ranges, family|
      assert_not_empty ranges
      ranges.each do |cidr|
        assert_match %r{\A[^/]+/\d+\z}, cidr
        assert IPAddr.new(cidr).public_send(family), cidr
      end
    end
  end

  test "trusted proxies retain defaults and append optional verified ranges" do
    proxies = ProductionTransport.trusted_proxies("TRUSTED_PROXY_CIDRS" => " 192.0.2.0/24, ,2001:db8::/32 ")
    ActionDispatch::RemoteIp::TRUSTED_PROXIES.each { |proxy| assert_includes proxies, proxy }
    assert_includes proxies, IPAddr.new("192.0.2.0/24")
    assert_includes proxies, IPAddr.new("2001:db8::/32")
    assert_raises(IPAddr::InvalidAddressError) { ProductionTransport.trusted_proxies("TRUSTED_PROXY_CIDRS" => "invalid") }
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
