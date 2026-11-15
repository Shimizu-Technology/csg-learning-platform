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
end
