class FrontendUrlResolver
  LOCAL_HOSTS = %w[localhost 127.0.0.1 0.0.0.0].freeze

  class << self
    def resolve(env: ENV, fallback: "http://localhost:5173")
      explicit = env["PUBLIC_FRONTEND_URL"].to_s.strip
      return explicit if explicit.present?

      urls = candidate_urls(env)
      return fallback if urls.empty?

      preferred_url(urls, env) || urls.first || fallback
    end

    private

    def candidate_urls(env)
      raw = env["FRONTEND_URL"].presence || env["ALLOWED_ORIGINS"].presence
      return [] if raw.blank?

      raw.split(",").map(&:strip).reject(&:blank?)
    end

    def preferred_url(urls, env)
      return urls.first unless production_env?(env)

      remote_https_url(urls) || remote_url(urls) || urls.first
    end

    def production_env?(env)
      env["RAILS_ENV"].to_s == "production" || env["RACK_ENV"].to_s == "production"
    end

    def remote_https_url(urls)
      urls.find { |url| https?(url) && !local_url?(url) }
    end

    def remote_url(urls)
      urls.find { |url| !local_url?(url) }
    end

    def https?(url)
      uri = URI.parse(url)
      uri.scheme == "https"
    rescue URI::InvalidURIError
      false
    end

    def local_url?(url)
      uri = URI.parse(url)
      LOCAL_HOSTS.include?(uri.host)
    rescue URI::InvalidURIError
      false
    end
  end
end
