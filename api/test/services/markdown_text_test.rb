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

  test "a fence inside a quote or list item ends with its container" do
    # The quote ends at the blank line, so the last two fences are a closed top-level pair.
    quoted = "> ```\n> x\n\n```\ny\n```"
    assert_equal quoted, MarkdownText.normalize(quoted)
    assert_equal "- ```rb\n  puts 1\n- Next step", MarkdownText.normalize("- ```rb\n  puts 1\n- Next step")
    # After the list item ends, an unindented fence is top-level and open.
    assert_equal "- ```rb\n  puts 1\n```\nx\n```", MarkdownText.normalize("- ```rb\n  puts 1\n```\nx")
    assert_equal "> ```js\n> a\n\n```\nb\n```", MarkdownText.normalize("> ```js\n> a\n\n```\nb")
  end

  test "fence lines inside an HTML block are HTML, not fences" do
    [
      "<div>\n```\n</div>",
      "<details>\n<summary>Hint</summary>\n```ruby\nputs 1\n</details>",
      "<!--\n```\n-->",
      "<pre>\n```\n</pre>",
      "> <div>\n> ```"
    ].each { |html| assert_equal html, MarkdownText.normalize(html), html }
    # The HTML block ends at the blank line; the fence after it is top-level.
    assert_equal "<div>x</div>\n\n```\ncode\n```", MarkdownText.normalize("<div>x</div>\n\n```\ncode")
    # An inline tag doesn't start an HTML block, and a tag-only line can't interrupt a paragraph.
    assert_equal "Use <span>\n```\nx\n```", MarkdownText.normalize("Use <span>\n```\nx")
    assert_equal "Text\n<span>\n```\nx\n```", MarkdownText.normalize("Text\n<span>\n```\nx")
  end

  test "a lazy paragraph line keeps its quote open" do
    assert_equal "> a ```\nlazy\n> ```", MarkdownText.normalize("> a ```\nlazy\n> ```")
    assert_equal "> quote\nlazy\n```\nx\n```", MarkdownText.normalize("> quote\nlazy\n```\nx")
  end

  test "closes a fence indented up to three spaces but not indented code" do
    assert_equal "  ```\nx\n  ```", MarkdownText.normalize("  ```\nx\n  ```")
    assert_equal "   ~~~\nx\n~~~", MarkdownText.normalize("   ~~~\nx")
    assert_equal "    ```\nindented code", MarkdownText.normalize("    ```\nindented code")
  end

  test "is idempotent" do
    [
      "Try:\n```js\nconst a = 1", "- ```rb\n  puts 1", "a\r\nb", "```\n```\n```",
      "> ```\n> x\n\n```\ny", "<div>\n```\n</div>\n\n```", "- ```rb\n  puts 1\n```\nx", "\t```\n\tx"
    ].each do |value|
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
