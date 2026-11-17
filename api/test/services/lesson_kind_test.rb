require "test_helper"

class LessonKindTest < ActiveSupport::TestCase
  setup do
    @mod = Curriculum.create!(name: "Kinds").modules.create!(name: "Kinds", position: 0, schedule_days: "daily")
  end

  test "the kind comes from the blocks, not the stored lesson type" do
    assert_equal "reading", kind(:exercise, [ :text, {} ], [ :exercise, { body: "Imported instructions" } ])
    assert_equal "exercise", kind(:video, [ :exercise, { submission_type: :text_submission } ])
    assert_equal "exercise", kind(:reading, [ :exercise, { filename: "111.rb" } ])
    assert_equal "exercise", kind(:reading, [ :exercise, { solution: "puts 1" } ])
    assert_equal "exercise", kind(:reading, [ :code_challenge, {} ])
    assert_equal "exercise", kind(:reading, [ :checkpoint, { submission_type: :text_submission } ])
    assert_equal "project", kind(:project, [ :exercise, { submission_type: :repo_url_submission } ])
    assert_equal "video", kind(:exercise, [ :video, { video_url: "https://example.com/v" } ], [ :exercise, { body: "Watch along" } ])
    assert_equal "recording", kind(:exercise, [ :recording, { video_url: "https://example.com/r" } ], [ :video, { video_url: "https://example.com/v" } ])
    assert_equal "checkpoint", kind(:exercise, [ :text, {} ], [ :checkpoint, {} ])
    assert_equal "reading", kind(:exercise)
  end

  private

  def kind(lesson_type, *blocks)
    lesson = @mod.lessons.create!(title: "Lesson #{@mod.lessons.count}", position: @mod.lessons.count, release_day: 0, lesson_type: lesson_type)
    blocks.each_with_index { |(type, attrs), index| lesson.content_blocks.create!(block_type: type, position: index, title: "Block", **attrs) }
    LessonKind.for(lesson.reload)
  end
end
