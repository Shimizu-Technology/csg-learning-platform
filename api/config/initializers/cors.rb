Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    allowed = ENV.fetch("ALLOWED_ORIGINS", ENV.fetch("FRONTEND_URL", "http://localhost:5173"))
    origins allowed.split(",").map(&:strip)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      credentials: true
  end
end
