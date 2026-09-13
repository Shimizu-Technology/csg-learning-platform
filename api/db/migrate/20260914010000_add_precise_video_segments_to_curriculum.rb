class AddPreciseVideoSegmentsToCurriculum < ActiveRecord::Migration[8.1]
  VERSION = 1
  CATALOG_PATH = Rails.root.join("config", "video_segments.json")

  def up
    catalog.each do |entry|
      block = ContentBlock.find_by(id: entry.fetch("content_block_id"))
      next unless block&.video? || block&.recording?
      next unless source_matches?(block.video_url, entry.fetch("source_id"))
      next if block.metadata.to_h.fetch("video_segments_version", 0).to_i >= VERSION

      block.update_columns(
        metadata: block.metadata.to_h.merge(
          "video_segments" => VideoSegmentSet.normalize(entry.fetch("video_segments")),
          "video_segments_version" => VERSION,
          "video_segments_review_method" => entry.fetch("review_method"),
          "video_segments_reviewed_at" => "2026-09-14"
        ),
        updated_at: Time.current
      )
    end
  end

  def down
    catalog.each do |entry|
      block = ContentBlock.find_by(id: entry.fetch("content_block_id"))
      next unless block&.metadata.to_h&.fetch("video_segments_version", nil).to_i == VERSION

      metadata = block.metadata.to_h.except("video_segments", "video_segments_version", "video_segments_review_method", "video_segments_reviewed_at")
      block.update_columns(metadata: metadata, updated_at: Time.current)
    end
  end

  private

  def catalog
    @catalog ||= JSON.parse(File.read(CATALOG_PATH))
  end

  def source_matches?(url, expected)
    expected.blank? || url.to_s.include?(expected)
  end
end
