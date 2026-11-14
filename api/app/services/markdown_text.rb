# Storage hygiene for the Markdown people write (messages, announcements,
# grading feedback, help-request replies). See docs/MARKDOWN.md.
#
# - Windows line endings become "\n", so every renderer sees the same lines.
# - A top-level code fence left open is closed at the end, matching how the
#   web and mobile renderers show it, so previews and older app builds can't
#   treat the rest of the text inconsistently.
#
# Valid Markdown is never changed. The scan follows CommonMark's block
# structure for the parts that decide where a fence belongs: quotes and list
# items (a fence inside one ends with it, so an open one there is left alone),
# HTML blocks (a fence line inside one is HTML, not a fence), and indented
# code. When a line could be read more than one way the text is left as written.
module MarkdownText
  QUOTE = /\A {0,3}> ?/
  LIST_ITEM = /\A( {0,3})([-+*]|\d{1,9}[.)])( +|\z)/
  FENCE_OPEN = /\A {0,3}(`{3,}|~{3,})(.*)\z/
  FENCE_CLOSE = /\A {0,3}(`{3,}|~{3,}) *\z/
  HEADING = /\A {0,3}\#{1,6}(?: |\z)/
  BLOCK_TAGS = %w[
    address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt
    fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link
    main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead
    title tr track ul
  ].freeze
  ATTRIBUTE = /\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?/
  # CommonMark HTML block starts (types 1-7) and the line that ends each one (nil: a blank line).
  HTML_BLOCKS = [
    [ /\A {0,3}<(?:pre|script|style|textarea)(?:\s|>|\z)/i, %r{</(?:pre|script|style|textarea)>}i ],
    [ /\A {0,3}<!--/, /-->/ ],
    [ /\A {0,3}<\?/, /\?>/ ],
    [ /\A {0,3}<![A-Za-z]/, />/ ],
    [ /\A {0,3}<!\[CDATA\[/, /\]\]>/ ],
    [ %r{\A {0,3}</?(?:#{BLOCK_TAGS.join('|')})(?:\s|/?>|\z)}i, nil ],
    [ %r{\A {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:#{ATTRIBUTE.source})*\s*/?>|</[A-Za-z][A-Za-z0-9-]*\s*>)\s*\z}, nil, :no_interrupt ]
  ].freeze

  def self.normalize(value)
    return value if value.nil?

    close_open_fence(value.to_s.gsub(/\r\n?/, "\n"))
  end

  def self.close_open_fence(text)
    containers = [] # :quote, or a list item's content column
    fence = nil     # [marker, container depth]
    html = nil      # [end pattern or nil, container depth]
    paragraph = false

    text.each_line(chomp: true) do |raw|
      line = expand_tabs(raw)
      matched, rest = continue_containers(containers, line)

      if fence
        if matched >= fence[1]
          fence = nil if closes_fence?(rest, fence[0])
          next
        end
        fence = nil # its container ended, so the fence did too
      elsif html
        if matched >= html[1]
          html = nil if html[0] ? rest.match?(html[0]) : rest.strip.empty?
          next
        end
        html = nil
      end

      if matched < containers.length
        # A paragraph line can continue lazily without its quote or list prefix,
        # unless it starts a block (any block: the paragraph it would interrupt is closing).
        next if paragraph && !rest.strip.empty? && !block_start?(rest)

        containers = containers.first(matched)
        paragraph = false
      end

      rest = open_containers(containers, rest)
      if rest.strip.empty?
        paragraph = false
      elsif !paragraph && indent(rest) >= 4
        next # indented code
      elsif (match = rest.match(FENCE_OPEN)) && !(match[1].start_with?("`") && match[2].include?("`"))
        fence = [ match[1], containers.length ]
        paragraph = false
      elsif (start = html_start(rest, paragraph))
        html = [ start[1], containers.length ] unless start[1]&.match?(rest.sub(start[0], ""))
        paragraph = false
      else
        paragraph = !rest.match?(HEADING) && !thematic_break?(rest)
      end
    end

    fence && fence[1].zero? ? "#{text.chomp}\n#{fence[0]}" : text
  end

  # How many open containers the line continues, and the line without their markers.
  def self.continue_containers(containers, line)
    rest = line
    containers.each_with_index do |container, index|
      if container == :quote
        return [ index, rest ] unless rest.match?(QUOTE)
        rest = rest.sub(QUOTE, "")
      elsif rest.strip.empty?
        rest = ""
      else
        return [ index, rest ] if indent(rest) < container
        rest = rest[container..]
      end
    end
    [ containers.length, rest ]
  end

  # Opens the quotes and list items that start the line; returns what follows them.
  def self.open_containers(containers, rest)
    loop do
      if rest.match?(QUOTE)
        containers << :quote
        rest = rest.sub(QUOTE, "")
      elsif (item = rest.match(LIST_ITEM)) && !thematic_break?(rest)
        spaces = item[3].length
        # Content starts after the marker and its spaces (one space when there are five or more, or none).
        spaces = 1 if spaces.zero? || spaces > 4
        containers << item[1].length + item[2].length + spaces
        rest = rest[item[0].length..].to_s
        rest = (" " * (item[3].length - spaces)) + rest if item[3].length > 4
      else
        return rest
      end
    end
  end

  def self.html_start(rest, paragraph)
    HTML_BLOCKS.find { |start, _end, rule| rest.match?(start) && !(rule == :no_interrupt && paragraph) }
  end

  def self.block_start?(rest)
    rest.match?(QUOTE) || rest.match?(LIST_ITEM) || rest.match?(FENCE_OPEN) || rest.match?(HEADING) ||
      thematic_break?(rest) || HTML_BLOCKS.any? { |start, _| rest.match?(start) }
  end

  def self.thematic_break?(rest)
    rest.match?(/\A {0,3}([-*_])(?: *\1){2,} *\z/)
  end

  def self.closes_fence?(rest, marker)
    match = rest.match(FENCE_CLOSE)
    match && match[1][0] == marker[0] && match[1].length >= marker.length
  end

  def self.indent(rest)
    rest[/\A */].length
  end

  # CommonMark indentation: a tab in leading whitespace advances to the next multiple of four columns.
  def self.expand_tabs(line)
    leading = line[/\A[ \t>]*/]
    expanded = leading.each_char.reduce(+"") { |out, character| character == "\t" ? out << " " * (4 - (out.length % 4)) : out << character }
    expanded + line[leading.length..]
  end

  private_class_method :close_open_fence, :continue_containers, :open_containers, :html_start, :block_start?,
    :thematic_break?, :closes_fence?, :indent, :expand_tabs
end
