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

  test "keeps bold code, escapes, strike, underline and snake_case readable (M-8)" do
    assert_equal "Run bin/rails db:migrate for user_id, not *this*. old new",
      MarkdownExcerpt.call("Run **`bin/rails db:migrate`** for user_id, not \\*this\\*. ~~old~~ ++new++")
    assert_equal "a*b*c stays", MarkdownExcerpt.call("`a*b*c` stays")
  end

  test "closes an unterminated fence and normalizes Windows line endings" do
    assert_equal "Try: const a = 1", MarkdownExcerpt.call("Try:\r\n```js\r\nconst a = 1\r\nconst b = 2")
  end

  test "reads table rows as cells" do
    assert_equal "Step Command Migrate db:migrate", MarkdownExcerpt.call("| Step | Command |\n|---|:---:|\n| Migrate | `db:migrate` |")
  end
end
