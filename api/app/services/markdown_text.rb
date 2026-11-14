# Storage hygiene for the Markdown people write (messages, announcements,
# grading feedback, help-request replies). See docs/MARKDOWN.md.
#
# - Windows line endings become "\n", so every renderer sees the same lines.
# - A top-level code fence left open is closed at the end, matching how the
#   web and mobile renderers show it, so previews and older app builds can't
#   treat the rest of the text inconsistently.
#
# Valid Markdown is never changed. A fence inside a list item or a quote ends
# with its container, so an open one there is left alone; so is one that is
# indented after a list, where it may belong to the list item.
module MarkdownText
  # Blockquote markers and list markers that start a line, possibly nested.
  CONTAINER_PREFIX = /\A[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+)/
  LIST_ITEM = /\A[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|\z)/
  FENCE_OPEN = /\A([ \t]*)(`{3,}|~{3,})(.*)\z/
  FENCE_CLOSE = /\A[ \t]*(`{3,}|~{3,})[ \t]*\z/

  def self.normalize(value)
    return value if value.nil?

    close_open_fence(value.to_s.gsub(/\r\n?/, "\n"))
  end

  def self.close_open_fence(text)
    open = nil
    top_level = false
    seen_list = false

    text.each_line(chomp: true) do |line|
      content, contained = strip_containers(line)

      if open
        # Closing fences are matched leniently (any indentation, inside any
        # container): when in doubt the text is left as written.
        match = content.match(FENCE_CLOSE)
        open = nil if match && match[1][0] == open[0] && match[1].length >= open.length
        next
      end

      seen_list ||= line.match?(LIST_ITEM)
      match = content.match(FENCE_OPEN)
      next unless match
      next if match[2].start_with?("`") && match[3].include?("`")

      open = match[2]
      indent = columns(match[1])
      top_level = !contained && (indent.zero? || (indent <= 3 && !seen_list))
    end

    open && top_level ? "#{text.chomp}\n#{open}" : text
  end

  # The line without blockquote and list-item markers, and whether it had any.
  def self.strip_containers(line)
    content = line
    contained = false
    while (prefix = content[CONTAINER_PREFIX])
      content = content.delete_prefix(prefix)
      contained = true
    end
    [ content, contained ]
  end

  # CommonMark indentation: a tab advances to the next multiple of four columns.
  def self.columns(whitespace)
    whitespace.each_char.reduce(0) { |total, character| character == "\t" ? total + 4 - (total % 4) : total + 1 }
  end

  private_class_method :close_open_fence, :strip_containers, :columns
end
