require "ipaddr"
require_relative "cloudflare_ip_ranges"

module ProductionTransport
  def self.trusted_proxies(env = ENV)
    ActionDispatch::RemoteIp::TRUSTED_PROXIES +
      (CloudflareIpRanges::IPV4 + CloudflareIpRanges::IPV6 +
        env.fetch("TRUSTED_PROXY_CIDRS", "").split(",").map(&:strip).reject(&:empty?)).map { |cidr| IPAddr.new(cidr) }
  end

  SSL_OPTIONS = {
    redirect: { exclude: ->(request) { request.path.in?([ "/health", "/up" ]) } },
    hsts: { expires: 1.year, subdomains: false, preload: false }
  }.freeze
end
