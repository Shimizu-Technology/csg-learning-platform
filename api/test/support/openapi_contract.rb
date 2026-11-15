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

  def process(method, path, **options)
    result = super
    contract = OPERATIONS.find { |verb, pattern, _| verb == request.request_method.downcase && pattern.match?(request.path) }
    if contract && response.successful? && response.status != 204
      definition = contract.last.fetch("responses")[response.status.to_s]
      raise Minitest::Assertion, "Undocumented success status #{response.status} for #{method} #{request.path}" unless definition
      COVERED.add([ contract.first, contract[1].source, response.status.to_s ])
      schema = definition.dig("content", "application/json", "schema")
      errors = SCHEMER.ref(schema.fetch("$ref")).validate(response.parsed_body).to_a
      raise Minitest::Assertion, "OpenAPI #{method} #{request.path}: #{errors.map { |error| error.slice('data_pointer', 'type', 'details') }.inspect}" unless errors.empty?
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
    abort "Untested OpenAPI responses: #{missing.inspect}" unless missing.empty?
  end
end
