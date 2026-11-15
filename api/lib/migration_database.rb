require "uri"
require "active_model"

# Called only by the migration Rake prerequisite, before Rails loads database.yml.
module MigrationDatabase
  class UnsafeConnection < StandardError; end

  def self.boolean(value)
    ActiveModel::Type::Boolean.new.cast(value)
  end

  def self.parse!(url)
    uri = URI.parse(url.to_s)
    unless %w[postgres postgresql].include?(uri.scheme) && uri.host && uri.user && uri.path.to_s.length > 1
      raise UnsafeConnection, "Migration blocked: invalid PostgreSQL configuration (details redacted)."
    end
    params = URI.decode_www_form(uri.query.to_s).to_h
    # Connection query overrides can redirect libpq away from the validated identity.
    if (params.keys & %w[host hostaddr port dbname database user username service servicefile]).any?
      raise UnsafeConnection, "Migration blocked: connection identity overrides are not supported (details redacted)."
    end
    [ uri, params ]
  rescue URI::InvalidURIError, ArgumentError
    raise UnsafeConnection, "Migration blocked: invalid PostgreSQL configuration (details redacted)."
  end

  def self.pooled?(uri, params)
    uri.host.downcase.match?(/-pooler|pgbouncer/) || boolean(params["pgbouncer"]&.downcase)
  end

  def self.identity(uri)
    [ uri.host.downcase.sub("-pooler.", "."), URI::DEFAULT_PARSER.unescape(uri.user), URI::DEFAULT_PARSER.unescape(uri.path) ]
  end

  def self.environment(env, output: $stderr)
    runtime, runtime_params = parse!(env["DATABASE_URL"])
    direct = env["MIGRATION_DATABASE_URL"]
    if direct
      selected, params = parse!(direct)
      if pooled?(selected, params) || identity(selected) != identity(runtime)
        raise UnsafeConnection, "Migration blocked: MIGRATION_DATABASE_URL must be direct and match the runtime database, user and endpoint (details redacted)."
      end
      if params.key?("advisory_locks") && !boolean(params["advisory_locks"])
        raise UnsafeConnection, "Migration blocked: direct migrations require advisory locks (details redacted)."
      end
      locks = true
    else
      selected, params = runtime, runtime_params
      locks = !pooled?(selected, params)
      unless locks
        output.puts "WARNING: MIGRATIONS ARE USING A TRANSACTION POOLER WITH ADVISORY LOCKS DISABLED. This assumes a single migration instance: never overlap deploys or manual schema commands. Add a matching direct MIGRATION_DATABASE_URL to restore serialization."
      end
    end
    # URL options win over database.yml, so enforce the migration policy here.
    params["advisory_locks"] = locks.to_s
    params["prepared_statements"] = "false"
    selected.query = URI.encode_www_form(params)
    { "DATABASE_URL" => selected.to_s }
  end
end
