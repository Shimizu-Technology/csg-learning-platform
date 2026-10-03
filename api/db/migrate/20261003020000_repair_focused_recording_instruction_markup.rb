require "nokogiri"

class RepairFocusedRecordingInstructionMarkup < ActiveRecord::Migration[8.1]
  PREVIOUS_OWNERSHIP_KEY = "recording_instruction_migration_20261003010000"
  OWNERSHIP_KEY = "recording_instruction_repair_20261003020000"
  INSTRUCTION_RANGES = {
    207 => "4:07–1:07:00",
    213 => "4:07–1:16:53",
    216 => "31:33–1:25:45",
    218 => "13:49–49:06",
    219 => "1:33:12–2:06:30",
    220 => "2:07:14–2:50:00",
    224 => "39:03–50:00 and 1:56:00–2:40:15"
  }.freeze
  REVIEWED_COPY = "Use the reviewed recording sections above. Each selection skips unrelated class time and pauses at its stop time."
  HTML_PARAGRAPH = /<p\b[^>]*>.*?<\/p>/mi

  def up
    ContentBlock.where(lesson_id: instruction_ranges.keys).where.not(body: nil).find_each do |block|
      metadata = block.metadata.to_h
      previous_marker = metadata.fetch(PREVIOUS_OWNERSHIP_KEY, nil)
      next unless previous_marker.is_a?(Hash)
      next unless block.body == previous_marker.fetch("installed_body", nil)

      previous_range = instruction_ranges.fetch(block.lesson_id)
      repaired_body = repair_body(previous_marker.fetch("body", ""), previous_range)
      next if repaired_body.blank? || repaired_body == block.body

      block.update_columns(
        body: repaired_body,
        metadata: metadata.merge(OWNERSHIP_KEY => { "body" => block.body, "installed_body" => repaired_body }),
        updated_at: Time.current
      )
    end
  end

  def down
    ContentBlock.where(lesson_id: instruction_ranges.keys).find_each do |block|
      metadata = block.metadata.to_h
      marker = metadata.fetch(OWNERSHIP_KEY, nil)
      next unless marker.is_a?(Hash) && marker.key?("body")

      block.update_columns(
        body: block.body == marker.fetch("installed_body", nil) ? marker.fetch("body") : block.body,
        metadata: metadata.except(OWNERSHIP_KEY),
        updated_at: Time.current
      )
    end
  end

  private

  def instruction_ranges
    INSTRUCTION_RANGES
  end

  def repair_body(original_body, previous_range)
    original_body.match?(HTML_PARAGRAPH) ? repair_html(original_body, previous_range) : repair_plain_text(original_body, previous_range)
  end

  def repair_html(body, previous_range)
    paragraph_match = paragraph_matches(body).find do |match|
      text = Nokogiri::HTML.fragment(match[0]).text
      text.downcase.include?("watch") && text.include?(previous_range)
    end
    return unless paragraph_match

    paragraph = paragraph_match[0]
    opening_tag = paragraph[/\A<p\b[^>]*>/i]
    range_end = paragraph.index(previous_range) + previous_range.length
    sentence_end = paragraph.index(".", range_end)
    closing_start = paragraph.rindex("</p>")
    tail = sentence_end ? paragraph[(sentence_end + 1)...closing_start].to_s : ""
    replacement = "#{opening_tag}<strong>Watch:</strong> #{REVIEWED_COPY}#{tail}</p>"

    body[...paragraph_match.begin(0)] + replacement + body[paragraph_match.end(0)..]
  end

  def paragraph_matches(body)
    matches = []
    body.scan(HTML_PARAGRAPH) { matches << Regexp.last_match.dup }
    matches
  end

  def repair_plain_text(body, previous_range)
    body.lines.map do |line|
      next line unless line.downcase.include?("watch") && line.include?(previous_range)

      range_end = line.index(previous_range) + previous_range.length
      sentence_end = line.index(".", range_end)
      tail = sentence_end ? line[(sentence_end + 1)..].to_s.strip : ""
      newline = line.end_with?("\n") ? "\n" : ""
      preserved_tail = tail.present? ? " #{tail}" : ""
      "#{line[/\A\s*/]}**Watch:** #{REVIEWED_COPY}#{preserved_tail}#{newline}"
    end.join
  end
end
