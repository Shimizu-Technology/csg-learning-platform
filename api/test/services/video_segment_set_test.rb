require "test_helper"

class VideoSegmentSetTest < ActiveSupport::TestCase
  test "normalizes and sorts recording sections" do
    assert_equal [
      { "label" => "Schema planning", "start_seconds" => 12, "end_seconds" => 95, "required" => true },
      { "label" => "Optional review", "start_seconds" => 120, "end_seconds" => 180, "required" => false }
    ], VideoSegmentSet.normalize([
      { label: " Optional review ", start_seconds: "120", end_seconds: "180", required: false },
      { label: "Schema planning", start_seconds: 12, end_seconds: 95 }
    ])
  end

  test "rejects invalid recording sections" do
    error = assert_raises(ArgumentError) do
      VideoSegmentSet.normalize([ { label: "Broken", start_seconds: 10, end_seconds: 10 } ])
    end

    assert_equal "Recording section 1 must end after it starts", error.message
  end
end
