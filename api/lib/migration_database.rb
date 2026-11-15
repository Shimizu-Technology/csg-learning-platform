require "uri"

# Keep the direct endpoint scoped to the migration subprocess, never the server.
module MigrationDatabase
  class UnsafeConnection < StandardError; end

  def self.environment(env)
    direct_url = env["MIGRATION_DATABASE_URL"]
    direct_url && !direct_url.strip.empty? ? { "DATABASE_URL" => direct_url } : {}
  end

  def self.verify!(config, output: $stdout)
    url = config[:url]
    uri = URI.parse(url) if url && !url.empty?
    if uri && (!%w[postgres postgresql].include?(uri.scheme) || uri.host.to_s.empty?)
      raise UnsafeConnection, "Migration blocked: expected a PostgreSQL URL with a direct host (details redacted)."
    end
    params = uri&.query ? URI.decode_www_form(uri.query).to_h : {}
    host = (config[:host] || uri&.host).to_s.downcase
    pooled = host.include?("-pooler") || host.include?("pgbouncer") ||
      [ config[:pgbouncer], params["pgbouncer"] ].any? { |value| [ true, "true", "1" ].include?(value) }
    if pooled && config.fetch(:advisory_locks, true) != false
      raise UnsafeConnection, "Migration blocked: session advisory locks cannot use a transaction pooler. Set MIGRATION_DATABASE_URL to the direct endpoint and run bin/migrate."
    end
    output.puts "Migration connection check passed (#{pooled ? 'pooler; advisory locks disabled' : 'no pooler marker'}). No connection details logged."
  rescue URI::InvalidURIError, ArgumentError
    raise UnsafeConnection, "Migration blocked: invalid database connection configuration (details redacted)."
  end
end
