class AddPreciseVideoSegmentsToCurriculum < ActiveRecord::Migration[8.1]
  VERSION = 1
  CATALOG_PATH = Rails.root.join("config", "video_segments.json")
  OWNERSHIP_KEY = "video_segments_migration_20260914010000"
  MANAGED_KEYS = %w[video_segments video_segments_version video_segments_review_method video_segments_reviewed_at].freeze

  def up
    catalog.each do |entry|
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
          "video_segments_review_method" => entry.fetch("review_method"),
          "video_segments_reviewed_at" => "2026-09-14",
          OWNERSHIP_KEY => previous
        ),
        updated_at: Time.current
      )
    end
  end

  def down
    catalog.each do |entry|
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

  def catalog
    @catalog ||= JSON.parse(File.read(CATALOG_PATH))
  end

  def source_matches?(url, expected)
    expected.blank? || url.to_s.include?(expected)
  end
end
