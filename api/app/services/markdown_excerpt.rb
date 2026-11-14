# Plain-text excerpt of Markdown for push notification bodies and emails, so a
# lock screen never shows literal `**`, `*why*`, or code fences.
#
# It reads the parsed CommonMark + GFM structure (commonmarker), the way the
# written renderers show the text: code keeps its text, escapes and entities
# read as they render, and HTML typed into the text stays as typed. The web and
# mobile `markdownExcerpt` helpers follow the same rules, and
# fixtures/markdown-excerpts.json holds all three in step (docs/MARKDOWN.md).
module MarkdownExcerpt
  OPTIONS = {
    # `insert` reads the composer's legacy ++underline++.
    extension: { table: true, strikethrough: true, autolink: true, tasklist: true, insert: true, shortcodes: false, tagfilter: false },
    parse: { smart: false }
  }.freeze
  BLOCKS = %i[paragraph heading block_quote item table_row table_cell code_block html_block].freeze

  def self.call(markdown, max_length: 180)
    return "" if markdown.blank?

    words = []
    # CommonMark reads a NUL character as U+FFFD.
    source = MarkdownText.normalize(markdown.to_s).tr("\u0000", "\uFFFD")
    collect(Commonmarker.parse(source, options: OPTIONS), words)
    text = words.join.gsub(/[[:space:]]+/, " ").strip
    text.length > max_length ? "#{text[0, max_length - 1].rstrip}…" : text
  end

  def self.collect(node, words)
    case node.type
    when :text, :code
      words << node.string_content
    when :html_inline, :html_block
      words << node.literal.to_s
    when :code_block
      # A code block contributes its first line, like the web and mobile excerpts.
      words << node.string_content.strip.split("\n").first.to_s
    when :softbreak, :linebreak
      words << " "
    else
      node.each { |child| collect(child, words) }
    end
    words << " " if BLOCKS.include?(node.type)
  end

  private_class_method :collect
end
