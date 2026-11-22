class FrontendUrlResolver
  LOCAL_HOSTS = %w[localhost 127.0.0.1 0.0.0.0].freeze

  class << self
    def resolve(env: ENV, fallback: "http://localhost:5173")
      explicit = env["PUBLIC_FRONTEND_URL"].to_s.strip
      return explicit if safe_origin?(explicit)

      urls = candidate_urls(env)
      return fallback if urls.empty?

      preferred_url(urls, env) || urls.first || fallback
    end

    def safe_origin?(url)
      return false if url.blank? || url.match?(/[\s\x00-\x1f\x7f\\]/)

      uri = URI.parse(url)
      (uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)) &&
        uri.host.present? &&
        uri.userinfo.nil? &&
        uri.query.nil? &&
        uri.fragment.nil?
    rescue URI::InvalidURIError
      false
    end

    def safe_deep_link(path, env: ENV)
      relative = path.to_s
      if !relative.start_with?("/") || relative.start_with?("//") || relative.match?(/[\s\x00-\x1f\x7f\\]/)
        raise ArgumentError, "Deep link path must be a safe relative application path"
      end

      origin = resolve(env: env).to_s.sub(%r{/\z}, "")
      raise ArgumentError, "Frontend URL origin is unsafe" unless safe_origin?(origin)

      "#{origin}#{relative}"
    end

    private

    def candidate_urls(env)
      raw = env["FRONTEND_URL"].presence || env["ALLOWED_ORIGINS"].presence
      return [] if raw.blank?

      raw.split(",").map(&:strip).select { |url| safe_origin?(url) }
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
