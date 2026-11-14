# Storage hygiene for the Markdown people write (messages, announcements,
# grading feedback, help-request replies). See docs/MARKDOWN.md.
#
# Windows line endings become "\n", so every renderer sees the same lines.
# Nothing else changes: a code fence left open is stored as typed, and every
# renderer runs it to the end of the text, as CommonMark does.
module MarkdownText
  def self.normalize(value)
    return value if value.nil?

    value.to_s.gsub(/\r\n?/, "\n")
  end

  # Drops blank lines at the start and end, and nothing else: the first line
  # keeps its indentation ("    code" is an indented code block). Matches
  # trimBlankLines in web/src/lib/messageFormat.ts. Use instead of #strip.
  def self.trim_blank_lines(value)
    text = normalize(value.to_s)
    return "" if text.strip.empty?

    text.sub(/\A(?:[ \t]*\n)+/, "").sub(/(?:\n[ \t]*)+\z/, "")
  end
end
