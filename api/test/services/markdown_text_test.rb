require "test_helper"

class MarkdownTextTest < ActiveSupport::TestCase
  test "normalizes Windows and old Mac line endings" do
    assert_equal "one\ntwo\n\nthree", MarkdownText.normalize("one\r\ntwo\r\n\r\nthree")
    assert_equal "a\nb", MarkdownText.normalize("a\rb")
    assert_nil MarkdownText.normalize(nil)
  end

  test "stores an unclosed fence as typed, and the excerpt reads it as code to the end" do
    typed = "Try:\r\n```js\r\nconst a = 1\r\n\r\nAfter **this**"
    stored = "Try:\n```js\nconst a = 1\n\nAfter **this**"
    assert_equal stored, MarkdownText.normalize(typed)
    assert_equal "~~~\nplain", MarkdownText.normalize("~~~\nplain")
    assert_equal "Try: const a = 1", MarkdownExcerpt.call(stored)
  end

  test "models store normalized Markdown for messages, announcements, feedback and help replies" do
    assert_equal "a\nb", Message.new(body: "a\r\nb").body
    assert_equal "```\nx", Announcement.new(body: "```\r\nx").body
    assert_equal "Nice\nwork", Submission.new(feedback: "Nice\r\nwork").feedback
    assert_equal "See\n```\ncode", HelpRequest.new(staff_response: "See\r\n```\r\ncode").staff_response
  end
end
