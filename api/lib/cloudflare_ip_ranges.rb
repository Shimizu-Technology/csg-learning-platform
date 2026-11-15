# Published by https://api.cloudflare.com/client/v4/ips
# Fetched 2026-11-15 UTC; etag: "38f79d050aa027e3be3865e495dcc9bc".
# Refresh against that endpoint: a missing new range falls back to edge keying;
# a removed range must be dropped promptly to avoid trusting a former proxy.
module CloudflareIpRanges
  IPV4 = %w[
    173.245.48.0/20
    103.21.244.0/22
    103.22.200.0/22
    103.31.4.0/22
    141.101.64.0/18
    108.162.192.0/18
    190.93.240.0/20
    188.114.96.0/20
    197.234.240.0/22
    198.41.128.0/17
    162.158.0.0/15
    104.16.0.0/13
    104.24.0.0/14
    172.64.0.0/13
    131.0.72.0/22
  ].freeze
  IPV6 = %w[
    2400:cb00::/32
    2606:4700::/32
    2803:f800::/32
    2405:b500::/32
    2405:8100::/32
    2a06:98c0::/29
    2c0f:f248::/32
  ].freeze
end
