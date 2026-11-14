# Plain-text excerpt of Markdown for push notification bodies and emails, so a
# lock screen never shows literal `**`, `*why*`, or code fences. Mirrors the
# web and mobile `markdownExcerpt` helpers (docs/MARKDOWN.md).
module MarkdownExcerpt
  ESCAPED = /\\([!-\/:-@\[-`{-~])/
  FENCED = /^[ \t]*(`{3,}|~{3,})[^\n]*\n(.*?)^[ \t]*\1[ \t]*$/m
  CODE_SPAN = /(`+)(.+?)\1/m
  PLACEHOLDER = /\u0000(\d+)\u0000/

  def self.call(markdown, max_length: 180)
    return "" if markdown.blank?

    # Escaped characters and code are literal: set them aside before stripping syntax.
    literals = []
    keep = ->(value) { literals << value; " \u0000#{literals.length - 1}\u0000 " }
    text = MarkdownText.normalize(markdown.to_s)
      .gsub(ESCAPED) { literals << Regexp.last_match(1); "\u0000#{literals.length - 1}\u0000" }
      .gsub(FENCED) { keep.call(Regexp.last_match(2).strip.split("\n").first.to_s) }
      .gsub(CODE_SPAN) { "\u0000#{literals.push(Regexp.last_match(2).strip).length - 1}\u0000" }

    text = text
      .gsub(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/, "")
      .gsub(/^[ \t]*\|(.*)\|[ \t]*$/) { Regexp.last_match(1).split("|").join(" ") }
      .gsub(/<\/?[a-zA-Z][^<>]*>/, " ")
      .gsub(/!\[([^\]]*)\]\([^)]*\)/, '\1')
      .gsub(/\[([^\]]+)\]\([^)]*\)/, '\1')
      .gsub(/(\*\*|__)(.+?)\1/, '\2')
      .gsub(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?=[^\w*]|$)/, '\1\2')
      .gsub(/~~(.+?)~~/, '\1')
      .gsub(/\+\+(.+?)\+\+/, '\1')
      .gsub(/^\s{0,3}(\#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
      .gsub("&nbsp;", " ").gsub("&amp;", "&").gsub("&lt;", "<").gsub("&gt;", ">")
      .gsub(PLACEHOLDER) { literals[Regexp.last_match(1).to_i] }
      .gsub(/\s+/, " ")
      .strip
    text.length > max_length ? "#{text[0, max_length - 1].rstrip}…" : text
  end
end
