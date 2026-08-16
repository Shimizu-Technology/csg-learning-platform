require "test_helper"

class ContentBlockTest < ActiveSupport::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Content Block Curriculum")
    curriculum_module = CurriculumModule.create!(
      curriculum: curriculum,
      name: "Prework",
      position: 0,
      schedule_days: "daily"
    )
    @lesson = Lesson.create!(
      curriculum_module: curriculum_module,
      title: "Variables",
      position: 0,
      release_day: 0
    )
  end

  test "normalizes duplicated protocol prefixes in video urls" do
    block = @lesson.content_blocks.create!(
      block_type: :video,
      position: 0,
      video_url: "htthttps://youtu.be/fhFHE7yHAjs"
    )

    assert_equal "https://youtu.be/fhFHE7yHAjs", block.video_url
  end

  test "rejects video urls without an http host" do
    block = @lesson.content_blocks.new(block_type: :video, position: 0, video_url: "youtube-video")

    refute block.valid?
    assert_includes block.errors[:video_url], "must be a valid http or https URL"
  end
end
