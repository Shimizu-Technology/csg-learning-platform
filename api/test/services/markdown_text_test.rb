require "test_helper"

class MarkdownTextTest < ActiveSupport::TestCase
  test "normalizes Windows line endings" do
    assert_equal "one\ntwo\n\nthree", MarkdownText.normalize("one\r\ntwo\r\n\r\nthree")
  end

  test "closes an unterminated fence with the same marker" do
    assert_equal "Try:\n````js\nconst a = 1\n````", MarkdownText.normalize("Try:\n````js\nconst a = 1")
    assert_equal "~~~\nplain\n~~~", MarkdownText.normalize("~~~\nplain")
  end

  test "leaves closed fences, inline backticks and nil alone" do
    closed = "```ruby\nputs 1\n```\nDone, and ``` mid-line stays."
    assert_equal closed, MarkdownText.normalize(closed)
    assert_equal "Use ```js``` inline", MarkdownText.normalize("Use ```js``` inline")
    assert_nil MarkdownText.normalize(nil)
  end

  test "models store normalized Markdown for messages, announcements, feedback and help replies" do
    assert_equal "a\nb", Message.new(body: "a\r\nb").body
    assert_equal "```\nx\n```", Announcement.new(body: "```\r\nx").body
    assert_equal "Nice\nwork", Submission.new(feedback: "Nice\r\nwork").feedback
    assert_equal "See\n```\ncode\n```", HelpRequest.new(staff_response: "See\r\n```\r\ncode").staff_response
  end
end
