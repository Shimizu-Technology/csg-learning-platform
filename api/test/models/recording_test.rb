require "test_helper"

class RecordingTest < ActiveSupport::TestCase
  setup do
    curriculum = Curriculum.create!(name: "Recording model curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Recording model cohort", start_date: Date.current, status: :active)
  end

  test "classifies supported secure recording hosts" do
    assert_equal "youtube", Recording.source_kind_for("https://youtu.be/abc123def45")
    assert_equal "vimeo", Recording.source_kind_for("https://vimeo.com/123456")
    assert_equal "loom", Recording.source_kind_for("https://www.loom.com/share/abcdef123456")
    assert_equal "direct", Recording.source_kind_for("https://cdn.example.com/class.mp4?token=abc")
    assert_equal "external", Recording.source_kind_for("https://example.com/class")
  end

  test "external recording does not require upload metadata" do
    recording = @cohort.recordings.new(
      title: "Linked replay",
      source_kind: "youtube",
      source_url: "https://youtube.com/watch?v=abc123def45",
      position: 0
    )

    assert recording.valid?
  end

  test "uploaded recording still requires upload metadata" do
    recording = @cohort.recordings.new(title: "Missing upload", source_kind: "uploaded", position: 0)

    assert_not recording.valid?
    assert_includes recording.errors[:s3_key], "can't be blank"
    assert_includes recording.errors[:content_type], "can't be blank"
    assert_includes recording.errors[:file_size], "can't be blank"
  end
end
