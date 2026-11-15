require "test_helper"

class OpenapiContractTest < ActiveSupport::TestCase
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
