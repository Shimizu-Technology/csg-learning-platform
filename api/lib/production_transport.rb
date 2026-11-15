module ProductionTransport
  SSL_OPTIONS = {
    redirect: { exclude: ->(request) { request.path.in?([ "/health", "/up" ]) } },
    hsts: { expires: 1.year, subdomains: false, preload: false }
  }.freeze
end
