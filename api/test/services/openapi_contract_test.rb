require "test_helper"

class OpenapiContractTest < ActiveSupport::TestCase
  test "document conforms to the OpenAPI 3.1 meta schema" do
    errors = JSONSchemer.openapi31_document.validate(OpenapiContract::DOCUMENT).to_a
    assert_empty errors, errors.map { |error| error.slice("data_pointer", "type", "details") }.inspect
  end

  test "every path template parameter is declared and required for each operation" do
    assert_empty missing_path_parameters(OpenapiContract::DOCUMENT)
  end

  test "path parameter guard accepts either level and checks every operation and placeholder" do
    parameter = { "name" => "id", "in" => "path", "required" => true, "schema" => { "type" => "integer" } }
    path = "/parents/{id}/children/{child_id}"
    child_parameter = parameter.merge("name" => "child_id")
    item = { "parameters" => [ parameter ], "get" => { "parameters" => [ child_parameter ] }, "patch" => {} }
    document = { "paths" => { path => item } }
    assert_equal [ "PATCH #{path}: child_id" ], missing_path_parameters(document)
    item["patch"]["parameters"] = [ child_parameter ]
    assert_empty missing_path_parameters(document)

    [ parameter.merge("in" => "query"), parameter.merge("required" => false), parameter.merge("name" => "other") ].each do |invalid|
      item["parameters"] = [ invalid ]
      assert_equal [ "GET #{path}: id", "PATCH #{path}: id" ], missing_path_parameters(document)
    end
  end

  def missing_path_parameters(document)
    document.fetch("paths").flat_map do |path, item|
      names = path.scan(/\{([^}]+)\}/).flatten.uniq
      item.slice(*OpenapiContract::HTTP_METHODS).flat_map do |method, operation|
        parameters = Array(item["parameters"]) + Array(operation["parameters"])
        names.filter_map do |name|
          declared = parameters.any? { |parameter| parameter["in"] == "path" && parameter["name"] == name && parameter["required"] == true }
          "#{method.upcase} #{path}: #{name}" unless declared
        end
      end
    end
  end

  test "required keys do not carry the role conditional placeholder" do
    assert_empty conditional_required_descriptions(OpenapiContract::DOCUMENT)
  end

  test "required key guard catches variants of conditional wording" do
    [ "Included only for staff module show.", "Included for staff responses.", "Only sent to staff.", "Available only to staff." ].each do |description|
      schema = { "required" => [ "id" ], "properties" => { "id" => { "description" => description } } }
      assert_equal [ "id" ], conditional_required_descriptions(schema)
      assert_empty conditional_required_descriptions(schema.merge("required" => []))
    end
  end

  def conditional_required_descriptions(node)
    case node
    when Hash
      own = Array(node["required"]).select do |key|
        key.is_a?(String) && node.dig("properties", key, "description").to_s.match?(/\AIncluded (only|for)|\bonly\b/i)
      end
      own + node.values.flat_map { |value| conditional_required_descriptions(value) }
    when Array
      node.flat_map { |value| conditional_required_descriptions(value) }
    else
      []
    end
  end

  test "user list schema does not inherit session only fields" do
    properties = OpenapiContract::DOCUMENT.dig("components", "schemas", "UserListItem", "properties")
    %w[community_policy is_admin is_staff].each { |key| assert_not properties.key?(key) }
  end

  test "nested response drift fails while documented nullable values pass" do
    validator = OpenapiContract::SCHEMER.ref("#/components/schemas/ProgressUpdateResponse")
    body = { "progress" => { "id" => 1, "content_block_id" => 2, "status" => "completed", "completed_at" => nil } }
    assert validator.valid?(body)
    assert_not validator.valid?(body.deep_merge("progress" => { "id" => "1" }))
    assert_not validator.valid?({ "progress" => body.fetch("progress").except("status") })
    assert_not validator.valid?(body.deep_merge("progress" => { "unannounced_field" => true }))
  end
  test "undocumented 204 fails but documented bodyless status passes" do
    operation = { "responses" => { "200" => {} } }
    error = assert_raises(Minitest::Assertion) do
      OpenapiContract.validate_response!(operation, 204, nil, label: "regression")
    end
    assert_match "Undocumented success status 204", error.message
    OpenapiContract.validate_response!({ "responses" => { "204" => {} } }, 204, nil, label: "regression")
  end

  test "an error status an operation documents is validated against its own schema" do
    operation = OpenapiContract::OPERATIONS.find { |verb, pattern, _| verb == "post" && pattern.match?("/api/v1/cohorts/1/curriculum_copy") }.last
    %w[busy content_moved].each do |code|
      OpenapiContract.validate_response!(operation, 409, { "error" => "Try again.", "code" => code }, label: "copy #{code}")
    end
    [ { "error" => "Try again.", "code" => "stale" }, { "error" => "Try again." }, { "error" => "Try again.", "code" => "busy", "extra" => 1 } ].each do |body|
      assert_raises(Minitest::Assertion) { OpenapiContract.validate_response!(operation, 409, body, label: "copy drift") }
    end
  end

  test "removing always emitted keys fails validation" do
    schema = OpenapiContract::SCHEMER.ref("#/components/schemas/VideoStreamResponse")
    body = { "stream_url" => "https://example.test/video", "expires_at" => "2026-11-15T00:00:00Z", "video_progress" => nil }
    assert schema.valid?(body)
    %w[expires_at video_progress].each do |key|
      assert_not schema.valid?(body.except(key)), "missing #{key} must fail"
    end
  end
  test "shared error contracts reject missing and malformed fields" do
    cases = {
      "401" => { "error" => "Unauthorized" },
      "403" => { "error" => "Forbidden", "code" => "feature_disabled", "feature" => "recordings" },
      "404" => { "errors" => [ "Missing record" ] },
      "422" => { "errors" => [ "Invalid input" ], "field_errors" => { "handle" => [ "taken" ] } },
      "429" => { "error" => "Too many requests", "retry_after" => 60 }
    }
    cases.each do |status, body|
      definition = OpenapiContract::DOCUMENT.dig("components", "responses", status)
      schema = OpenapiContract::SCHEMER.ref(definition.dig("content", "application/json", "schema", "$ref"))
      assert schema.valid?(body), status
      assert_not schema.valid?({}), status
      assert_not schema.valid?(body.merge(body.key?("error") ? { "error" => 7 } : { "errors" => [ 7 ] })), status
      assert_not schema.valid?(body.merge("unexpected" => true)), status
    end
    rate_limit = OpenapiContract::SCHEMER.ref("#/components/schemas/ApiRateLimitError")
    assert_not rate_limit.valid?({ "error" => "Too many requests" })
    assert_not rate_limit.valid?({ "error" => "Too many requests", "retry_after" => "60" })
  end
end
