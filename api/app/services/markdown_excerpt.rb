# Plain-text excerpt of instructor markdown for push notification bodies, so a
# lock screen never shows literal `**`, `*why*`, or code fences. Mirrors the
# web and mobile `markdownExcerpt` helpers.
module MarkdownExcerpt
  def self.call(markdown, max_length: 180)
    return "" if markdown.blank?

    text = markdown.to_s
      .gsub(/<\/?[a-zA-Z][^<>]*>/, " ")
      .gsub(/```[\w+-]*\n?([\s\S]*?)```/) { " #{Regexp.last_match(1).strip.split("\n").first} " }
      .gsub(/!\[([^\]]*)\]\([^)]*\)/, '\1')
      .gsub(/\[([^\]]+)\]\([^)]*\)/, '\1')
      .gsub(/`([^`]+)`/, '\1')
      .gsub(/(\*\*|__)(.+?)\1/, '\2')
      .gsub(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?=[^\w*]|$)/, '\1\2')
      .gsub(/^\s{0,3}(\#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
      .gsub("&nbsp;", " ").gsub("&amp;", "&").gsub("&lt;", "<").gsub("&gt;", ">")
      .gsub(/\s+/, " ")
      .strip
    text.length > max_length ? "#{text[0, max_length - 1].rstrip}…" : text
  end
end
