require "test_helper"

class MarkdownExcerptTest < ActiveSupport::TestCase
  test "strips markdown emphasis, code, links, and fences" do
    feedback = "**Close!** Explain *why* `\"2\" + \"3\"` joins.\n\n```python\nfor word in words:\n    print(word)\n```\n\nSee [the notes](https://example.com)."
    assert_equal "Close! Explain why \"2\" + \"3\" joins. for word in words: See the notes.", MarkdownExcerpt.call(feedback)
  end

  test "truncates long text with an ellipsis and handles blanks" do
    assert_equal "", MarkdownExcerpt.call(nil)
    assert_equal "#{'a' * 9}…", MarkdownExcerpt.call("a" * 30, max_length: 10)
  end
end
