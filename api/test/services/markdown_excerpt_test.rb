require "test_helper"

class MarkdownExcerptTest < ActiveSupport::TestCase
  # The same input → excerpt pairs the web and mobile markdownExcerpt tests read.
  JSON.parse(Rails.root.join("../fixtures/markdown-excerpts.json").read).fetch("cases").each do |example|
    test "shared fixture: #{example.fetch('name')}" do
      assert_equal example.fetch("excerpt"), MarkdownExcerpt.call(example.fetch("markdown"))
    end
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
end
