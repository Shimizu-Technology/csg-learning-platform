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

  test "runner config keeps other keys, trims checks and drops empty optional fields" do
    block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, submission_type: :text_submission, submission_config: {
      "notes" => "keep me",
      runner: { enabled: true, language: " Ruby ", starter_code: "", checks: [ { id: " c1 ", name: " Prints ", code: "assert true" } ] }
    })

    assert_equal "keep me", block.submission_config["notes"]
    assert_equal({ "enabled" => true, "language" => "ruby", "checks" => [ { "id" => "c1", "name" => "Prints", "code" => "assert true" } ] },
      block.submission_config["runner"])
    assert block.runner_checks?

    block.update!(submission_config: { "runner" => { "enabled" => false, "starter_code" => nil, "checks" => [] } })
    assert_equal({ "enabled" => false }, block.reload.submission_config["runner"])
    assert_not block.runner_checks?
    block.update!(submission_config: { "runner" => { "enabled" => true, "checks" => nil } })
    assert_equal({ "enabled" => true }, block.reload.submission_config["runner"])
  end

  test "runner config refuses malformed shapes, oversized code, duplicate ids, too many checks and other languages" do
    check = ->(id = "c1", **overrides) { { "id" => id, "name" => "Check", "code" => "assert true" }.merge(overrides.stringify_keys) }
    invalid = {
      "not an object" => "runner must be an object",
      { "enabled" => "yes" } => "runner enabled must be true or false",
      { "enabled" => "true" } => "runner enabled must be true or false",
      { "enabled" => nil } => "runner enabled must be true or false",
      { "enabled" => 1 } => "runner enabled must be true or false",
      { "language" => nil } => "runner language must be ruby or javascript",
      { "checks" => { "id" => "c1" } } => "runner checks must be a list",
      { "language" => "python" } => "runner language must be ruby or javascript",
      { "timeout" => 5 } => "runner has unsupported settings: timeout",
      { "starter_code" => 12 } => "runner starter code must be text",
      { "starter_code" => "x" * 20_001 } => "runner starter code must be 20,000 characters or fewer",
      { "checks" => "assert true" } => "runner checks must be a list",
      { "checks" => Array.new(21) { |index| check.call("c#{index}") } } => "runner can have at most 20 checks",
      { "checks" => [ "assert true" ] } => "runner check 1 must have only an id, name and code",
      { "checks" => [ check.call.merge("passed" => true) ] } => "runner check 1 must have only an id, name and code",
      { "checks" => [ check.call(" ") ] } => "runner check 1 needs a id",
      { "checks" => [ check.call(name: "") ] } => "runner check 1 needs a name",
      { "checks" => [ check.call(code: " ") ] } => "runner check 1 needs a check code",
      { "checks" => [ check.call("x" * 65) ] } => "runner check 1 id must be 64 characters or fewer",
      { "checks" => [ check.call(name: "x" * 121) ] } => "runner check 1 name must be 120 characters or fewer",
      { "checks" => [ check.call(code: "x" * 10_001) ] } => "runner check 1 code must be 10,000 characters or fewer",
      { "checks" => [ check.call, check.call ] } => "runner check ids must be unique"
    }
    invalid.each do |runner, message|
      block = @lesson.content_blocks.build(block_type: :exercise, position: 0, submission_type: :text_submission, submission_config: { "runner" => runner })
      assert_not block.valid?, runner.inspect.first(80)
      assert_includes block.errors[:submission_config], message, runner.inspect.first(80)
    end

    limits = { "starter_code" => "x" * 20_000, "checks" => Array.new(20) { |index| check.call("c#{index}", code: "x" * 10_000) } }
    assert @lesson.content_blocks.build(block_type: :exercise, position: 0, submission_config: { "runner" => limits }).valid?
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
