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

  test "effective submission type legacy truth table and explicit precedence" do
    JSON.parse(File.read(Rails.root.join("../fixtures/effective-submission-type.json"))).each do |row|
      @lesson.update!(requires_submission: row.fetch("requires_submission"))
      @lesson.curriculum_module.update!(module_type: row.fetch("prework") ? :prework : :live_class)
      block = @lesson.content_blocks.build(block_type: row.fetch("block"), filename: row["filename"], position: 0)
      assert_equal row.fetch("expected"), block.effective_submission_type(requires_github: row.fetch("requires_github")), row.inspect
      ContentBlock.submission_types.keys.each do |explicit|
        block.submission_type = explicit
        assert_equal explicit, block.effective_submission_type(requires_github: row.fetch("requires_github"))
      end
    end
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

  test "display_title falls back to the lesson title and then a generic label" do
    block = ContentBlock.new(lesson: @lesson, block_type: :exercise, position: 0, title: "  ")
    assert_equal "Variables", block.display_title
    block.title = "Swap two values"
    assert_equal "Swap two values", block.display_title
    block.title = nil
    @lesson.title = ""
    assert_equal "your exercise", block.display_title
    assert_equal "Exercise", block.display_title(fallback: "Exercise")
  end
end
