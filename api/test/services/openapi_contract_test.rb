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
end
