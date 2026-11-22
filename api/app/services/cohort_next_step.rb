class CohortNextStep
  KEYS = %w[title description url offering_slug].freeze

  def self.for(cohort)
    normalize(cohort.settings.to_h["next_step"])
  rescue ArgumentError
    nil
  end

  def self.normalize(input)
    return unless input.is_a?(Hash)

    fields = input.slice(*KEYS).transform_values do |value|
      raise ArgumentError, "Next-step fields must be text" unless value.nil? || value.is_a?(String)

      value&.strip.presence
    end.compact
    return if fields.empty?

    unless fields["title"]&.length&.between?(1, 120) && fields["description"].to_s.length <= 500
      raise ArgumentError, "Give the next step a title of up to 120 characters and a description of up to 500 characters"
    end

    url, slug = fields.values_at("url", "offering_slug")
    unless (url.present? && safe_url?(url) && slug.nil?) || (url.nil? && slug.to_s.match?(/\A[a-z0-9][a-z0-9-]{0,119}\z/))
      raise ArgumentError, "Enter one next-step destination: an HTTP or HTTPS URL, or an offering slug"
    end

    fields
  end

  def self.safe_url?(value)
    return false if value.bytesize > 2048

    uri = URI.parse(value)
    uri.is_a?(URI::HTTP) && uri.host.present? && uri.userinfo.nil?
  rescue URI::InvalidURIError
    false
  end
  private_class_method :safe_url?
end
