# Storage hygiene for the Markdown people write (messages, announcements,
# grading feedback, help-request replies). See docs/MARKDOWN.md.
#
# - Windows line endings become "\n", so every renderer sees the same lines.
# - A code fence left open is closed at the end, matching how the web and
#   mobile renderers show it, so previews and older app builds can't treat the
#   rest of the text inconsistently.
module MarkdownText
  FENCE_OPEN = /\A[ \t]*(`{3,}|~{3,})(.*)\z/
  FENCE_CLOSE = /\A[ \t]*(`{3,}|~{3,})[ \t]*\z/

  def self.normalize(value)
    return value if value.nil?

    close_open_fence(value.to_s.gsub(/\r\n?/, "\n"))
  end

  def self.close_open_fence(text)
    open = nil
    text.each_line(chomp: true) do |line|
      if open
        match = line.match(FENCE_CLOSE)
        open = nil if match && match[1][0] == open[0] && match[1].length >= open.length
      elsif (match = line.match(FENCE_OPEN)) && !(match[1].start_with?("`") && match[2].include?("`"))
        open = match[1]
      end
    end
    open ? "#{text.chomp}\n#{open}" : text
  end
end
