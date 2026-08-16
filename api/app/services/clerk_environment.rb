class ClerkEnvironment
  NAMES = %w[development production].freeze

  attr_reader :name, :issuer, :secret_key, :jwks_url, :audience, :authorized_parties

  def self.all
    explicit = NAMES.filter_map { |name| from_prefix(name) }
    legacy = legacy_environment
    explicit << legacy if legacy && explicit.none? { |environment| environment.issuer == legacy.issuer }
    explicit
  end

  def self.for_issuer(issuer)
    normalized = normalize_issuer(issuer)
    return nil if normalized.blank?

    all.find { |environment| environment.issuer == normalized }
  end

  def self.primary
    preferred = ENV.fetch("CLERK_PRIMARY_ENVIRONMENT", "").strip.downcase
    environments = all
    return environments.find { |environment| environment.name == preferred } if preferred.present?

    environments.find(&:development?) ||
      environments.find { |environment| environment.name == "legacy" } ||
      environments.find(&:production?) ||
      environments.first
  end

  def self.normalize_issuer(value)
    value.to_s.strip.delete_suffix("/")
  end

  def initialize(name:, issuer:, secret_key: nil, jwks_url: nil, audience: nil, authorized_parties: [])
    @name = name
    @issuer = self.class.normalize_issuer(issuer)
    @secret_key = secret_key.presence
    @jwks_url = jwks_url.presence || "#{@issuer}/.well-known/jwks.json"
    @audience = audience
    @authorized_parties = authorized_parties
  end

  def production?
    name == "production"
  end

  def development?
    name == "development"
  end

  class << self
    private

    def from_prefix(name)
      prefix = "CLERK_#{name.upcase}"
      issuer = normalize_issuer(ENV.fetch("#{prefix}_ISSUER", ""))
      return nil if issuer.blank?

      new(
        name: name,
        issuer: issuer,
        secret_key: ENV["#{prefix}_SECRET_KEY"],
        jwks_url: ENV["#{prefix}_JWKS_URL"],
        audience: parse_list(ENV["#{prefix}_AUDIENCE"], collapse_single: true),
        authorized_parties: parse_list(ENV["#{prefix}_AUTHORIZED_PARTIES"])
      )
    end

    def legacy_environment
      issuer = normalize_issuer(ENV.fetch("CLERK_ISSUER", ""))
      return nil if issuer.blank?

      new(
        name: "legacy",
        issuer: issuer,
        secret_key: ENV["CLERK_SECRET_KEY"],
        jwks_url: ENV["CLERK_JWKS_URL"],
        audience: parse_list(ENV["CLERK_AUDIENCE"], collapse_single: true),
        authorized_parties: parse_list(ENV["CLERK_AUTHORIZED_PARTIES"])
      )
    end

    def parse_list(value, collapse_single: false)
      entries = value.to_s.split(",").map(&:strip).reject(&:blank?)
      collapse_single && entries.one? ? entries.first : entries
    end
  end
end
