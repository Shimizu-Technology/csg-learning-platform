require "test_helper"

class AddPreciseVideoSegmentsToCurriculumTest < ActiveSupport::TestCase
  test "catalog maps every production recording block once with valid exact ranges" do
    catalog = JSON.parse(File.read(Rails.root.join("config", "video_segments.json")))

    assert_equal 209, catalog.length
    assert_equal catalog.length, catalog.map { |entry| entry.fetch("content_block_id") }.uniq.length
    assert catalog.all? { |entry| entry.fetch("video_segments").present? }
    catalog.each do |entry|
      assert_equal entry.fetch("video_segments"), VideoSegmentSet.normalize(entry.fetch("video_segments"))
    end
  end
end
