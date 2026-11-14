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

  test "leaves a fence inside a list item or a quote unchanged" do
    [
      "- ```rb\n  puts 1\n  ```",
      "1. Step one\n   ```bash\n   ls -a\n   ```\n2. Step two",
      "> ```js\n> const a = 1\n> ```",
      "- Parent\n  - ```rb\n    puts 1\n    ```"
    ].each { |valid| assert_equal valid, MarkdownText.normalize(valid), valid }
  end

  test "leaves an open fence inside a container alone, since it ends with the container" do
    [
      "> ```js\n> const a = 1",
      "- ```rb\n  puts 1",
      "- item\n\n  ```rb\n  puts 1"
    ].each { |open| assert_equal open, MarkdownText.normalize(open), open }
  end

  test "closes a fence indented up to three spaces but not indented code" do
    assert_equal "  ```\nx\n  ```", MarkdownText.normalize("  ```\nx\n  ```")
    assert_equal "   ~~~\nx\n~~~", MarkdownText.normalize("   ~~~\nx")
    assert_equal "    ```\nindented code", MarkdownText.normalize("    ```\nindented code")
  end

  test "is idempotent" do
    [ "Try:\n```js\nconst a = 1", "- ```rb\n  puts 1", "a\r\nb", "```\n```\n```" ].each do |value|
      once = MarkdownText.normalize(value)
      assert_equal once, MarkdownText.normalize(once), value
    end
  end

  test "models store normalized Markdown for messages, announcements, feedback and help replies" do
    assert_equal "a\nb", Message.new(body: "a\r\nb").body
    assert_equal "```\nx\n```", Announcement.new(body: "```\r\nx").body
    assert_equal "Nice\nwork", Submission.new(feedback: "Nice\r\nwork").feedback
    assert_equal "See\n```\ncode\n```", HelpRequest.new(staff_response: "See\r\n```\r\ncode").staff_response
  end
end
