require "json_schemer"

# Validate covered successful responses across existing request regressions.
module OpenapiContract
  DOCUMENT = JSON.parse(Rails.root.join("../docs/openapi.json").read)
  SCHEMER = JSONSchemer.schema(DOCUMENT)
  OPERATIONS = DOCUMENT.fetch("paths").flat_map do |path, methods|
    pattern = Regexp.new("\\A#{path.gsub(/\{[^}]+\}/, '[^/]+')}\\z")
    methods.map { |method, operation| [ method, pattern, operation ] }
  end.freeze

  COVERED = Set.new
  EXERCISED_SCHEMAS = Set.new
  # Request-only schemas are not expected in validated responses.
  SCHEMA_COVERAGE_EXCEPTIONS = %w[VideoProgressInput WatchProgressInput].freeze

  def self.observe(value, pointer)
    return if value.nil?

    schema = pointer.delete_prefix("#/").split("/").reduce(DOCUMENT) { |node, key| node.is_a?(Array) ? node.fetch(key.to_i) : node.fetch(key) }
    if schema["$ref"]
      ref = schema.fetch("$ref")
      EXERCISED_SCHEMAS.add(ref.delete_prefix("#/components/schemas/"))
      observe(value, ref)
    end
    %w[anyOf oneOf allOf].each do |keyword|
      schema.fetch(keyword, []).each_index do |index|
        branch = "#{pointer}/#{keyword}/#{index}"
        observe(value, branch) if SCHEMER.ref(branch).valid?(value)
      end
    end
    if value.is_a?(Hash)
      schema.fetch("properties", {}).each_key do |key|
        observe(value[key], "#{pointer}/properties/#{key}") if value.key?(key)
      end
    elsif value.is_a?(Array) && schema["items"]
      value.each { |item| observe(item, "#{pointer}/items") }
    end
  end

  def self.validate_response!(operation, status, body, label:)
    definition = operation.fetch("responses")[status.to_s]
    raise Minitest::Assertion, "Undocumented success status #{status} for #{label}" unless definition

    schema = definition.dig("content", "application/json", "schema")
    return unless schema # Only explicitly documented bodyless responses skip validation.

    errors = SCHEMER.ref(schema.fetch("$ref")).validate(body).to_a
    raise Minitest::Assertion, "OpenAPI #{label}: #{errors.map { |error| error.slice('data_pointer', 'type', 'details') }.inspect}" unless errors.empty?

    EXERCISED_SCHEMAS.add(schema.fetch("$ref").delete_prefix("#/components/schemas/"))
    observe(body, schema.fetch("$ref"))
  end

  def process(method, path, **options)
    result = super
    contract = OPERATIONS.find { |verb, pattern, _| verb == request.request_method.downcase && pattern.match?(request.path) }
    if contract && response.successful?
      OpenapiContract.validate_response!(contract.last, response.status, response.body.present? ? response.parsed_body : nil, label: "#{method} #{request.path}")
      COVERED.add([ contract.first, contract[1].source, response.status.to_s ])
    end
    result
  end
end

ActionDispatch::Integration::Session.prepend(OpenapiContract)

# Run serially when checking the whole inventory so observations stay in-process.
if ENV["OPENAPI_COVERAGE"] == "1"
  Minitest.after_run do
    expected = OpenapiContract::OPERATIONS.flat_map do |verb, pattern, operation|
      operation.fetch("responses").keys.map { |status| [ verb, pattern.source, status ] }
    end
    missing = expected - OpenapiContract::COVERED.to_a
    unexercised = OpenapiContract::DOCUMENT.fetch("components").fetch("schemas").keys -
      OpenapiContract::EXERCISED_SCHEMAS.to_a - OpenapiContract::SCHEMA_COVERAGE_EXCEPTIONS
    abort "Untested OpenAPI responses: #{missing.inspect}; unexercised schemas: #{unexercised.inspect}" unless missing.empty? && unexercised.empty?
  end
end
