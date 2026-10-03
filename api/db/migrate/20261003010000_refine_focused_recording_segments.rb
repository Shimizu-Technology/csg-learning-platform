class RefineFocusedRecordingSegments < ActiveRecord::Migration[8.1]
  VERSION = 2
  CATALOG_PATH = Rails.root.join("config", "video_segments.json")
  REVIEW_METHOD = "student_path_transcript_reviewed"
  OWNERSHIP_KEY = "video_segments_migration_20261003010000"
  INSTRUCTION_OWNERSHIP_KEY = "recording_instruction_migration_20261003010000"
  MANAGED_KEYS = %w[video_segments video_segments_version video_segments_review_method video_segments_reviewed_at].freeze
  INSTRUCTION_RANGES = {
    207 => "4:07–1:07:00",
    213 => "4:07–1:16:53",
    216 => "31:33–1:25:45",
    218 => "13:49–49:06",
    219 => "1:33:12–2:06:30",
    220 => "2:07:14–2:50:00",
    224 => "39:03–50:00 and 1:56:00–2:40:15"
  }.freeze
  REVIEWED_INSTRUCTION = "**Watch:** Use the reviewed recording sections above. Each selection skips unrelated class time and pauses at its stop time."

  def up
    focused_catalog.each do |entry|
      block = ContentBlock.find_by(id: entry.fetch("content_block_id"))
      next unless block&.video? || block&.recording?
      next unless source_matches?(block.video_url, entry.fetch("source_id"))
      next if block.metadata.to_h.fetch("video_segments_version", 0).to_i >= VERSION

      metadata = block.metadata.to_h
      previous = {
        "present_keys" => MANAGED_KEYS.select { |key| metadata.key?(key) },
        "values" => metadata.slice(*MANAGED_KEYS)
      }
      block.update_columns(
        metadata: metadata.merge(
          "video_segments" => VideoSegmentSet.normalize(entry.fetch("video_segments")),
          "video_segments_version" => VERSION,
          "video_segments_review_method" => REVIEW_METHOD,
          "video_segments_reviewed_at" => "2026-10-03",
          OWNERSHIP_KEY => previous
        ),
        updated_at: Time.current
      )
    end

    update_reviewed_instructions
  end

  def down
    restore_reviewed_instructions

    focused_catalog.each do |entry|
      block = ContentBlock.find_by(id: entry.fetch("content_block_id"))
      metadata = block&.metadata.to_h
      marker = metadata&.fetch(OWNERSHIP_KEY, nil)
      next unless marker.is_a?(Hash)

      restored = metadata.except(*MANAGED_KEYS, OWNERSHIP_KEY)
      marker.fetch("present_keys", []).each do |key|
        restored[key] = marker.fetch("values", {})[key]
      end
      block.update_columns(metadata: restored, updated_at: Time.current)
    end
  end

  private

  def focused_catalog
    @focused_catalog ||= JSON.parse(File.read(CATALOG_PATH)).select do |entry|
      entry.fetch("review_method") == REVIEW_METHOD
    end
  end

  def instruction_ranges
    INSTRUCTION_RANGES
  end

  def update_reviewed_instructions
    instruction_ranges.each do |lesson_id, previous_range|
      lesson = Lesson.find_by(id: lesson_id)
      next unless lesson

      lesson.content_blocks.where.not(body: nil).find_each do |block|
        lines = block.body.lines
        next unless lines.any? { |line| watch_line?(line, previous_range) }

        metadata = block.metadata.to_h
        next if metadata.key?(INSTRUCTION_OWNERSHIP_KEY)

        updated_body = lines.map do |line|
          next line unless watch_line?(line, previous_range)

          reviewed_instruction_line(line, previous_range)
        end.join
        block.update_columns(
          body: updated_body,
          metadata: metadata.merge(INSTRUCTION_OWNERSHIP_KEY => { "body" => block.body }),
          updated_at: Time.current
        )
      end
    end
  end

  def restore_reviewed_instructions
    ContentBlock.where(lesson_id: instruction_ranges.keys).find_each do |block|
      metadata = block.metadata.to_h
      marker = metadata.fetch(INSTRUCTION_OWNERSHIP_KEY, nil)
      next unless marker.is_a?(Hash) && marker.key?("body")

      block.update_columns(
        body: marker.fetch("body"),
        metadata: metadata.except(INSTRUCTION_OWNERSHIP_KEY),
        updated_at: Time.current
      )
    end
  end

  def watch_line?(line, previous_range)
    line.include?(previous_range) && line.downcase.include?("watch")
  end

  def reviewed_instruction_line(line, previous_range)
    range_end = line.index(previous_range) + previous_range.length
    sentence_end = line.index(".", range_end)
    tail = sentence_end ? line[(sentence_end + 1)..].to_s.strip : ""
    newline = line.end_with?("\n") ? "\n" : ""
    preserved_tail = tail.present? ? " #{tail}" : ""
    "#{line[/\A\s*/]}#{REVIEWED_INSTRUCTION}#{preserved_tail}#{newline}"
  end

  def source_matches?(url, expected)
    expected.blank? || url.to_s.include?(expected)
  end
end
