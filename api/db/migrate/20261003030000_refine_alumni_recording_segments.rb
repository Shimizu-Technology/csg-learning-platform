require "nokogiri"
require "uri"

class RefineAlumniRecordingSegments < ActiveRecord::Migration[8.1]
  VERSION = 3
  CATALOG_PATH = Rails.root.join("config", "video_segments.json")
  REVIEW_METHOD = "alumni_library_transcript_reviewed"
  REVIEWED_AT = "2026-10-03"
  OWNERSHIP_KEY = "video_segments_migration_20261003030000"
  INSTRUCTION_OWNERSHIP_KEY = "recording_instruction_migration_20261003030000"
  MANAGED_KEYS = %w[video_segments video_segments_version video_segments_review_method video_segments_reviewed_at].freeze
  PREVIOUS_HEADING = "Recommended viewing"
  REVIEWED_HEADING = "Focused recording path"
  REVIEWED_INSTRUCTION = "Choose a reviewed section above to skip classroom logistics, breaks, individual troubleshooting, and work periods. The complete class recording remains available when you want more context."
  TIMESTAMP_RANGE = /\A\s*(?:\d+:)?\d{1,2}:\d{2}\s*[–-]\s*(?:\d+:)?\d{1,2}:\d{2}\s*\z/

  def up
    applied_sources = {}
    alumni_catalog.each do |entry|
      block = ContentBlock.find_by(id: entry.fetch("content_block_id"))
      next unless block

      applied = block.with_lock do
        next unless block.video? || block.recording?
        next unless source_matches?(block.video_url, entry.fetch("source_id"))

        metadata = block.metadata.to_h
        next if metadata.fetch("video_segments_review_method", nil) == "staff_authored"
        next if metadata.fetch("video_segments_version", 0).to_i >= VERSION

        installed = {
          "video_segments" => VideoSegmentSet.normalize(entry.fetch("video_segments")),
          "video_segments_version" => VERSION,
          "video_segments_review_method" => REVIEW_METHOD,
          "video_segments_reviewed_at" => REVIEWED_AT
        }
        previous = {
          "present_keys" => MANAGED_KEYS.select { |key| metadata.key?(key) },
          "values" => metadata.slice(*MANAGED_KEYS),
          "installed_values" => installed
        }
        block.update_columns(
          metadata: metadata.merge(installed).merge(OWNERSHIP_KEY => previous),
          updated_at: Time.current
        )
        [ block.lesson_id, entry.fetch("source_id") ]
      end
      applied_sources[applied.first] = applied.last if applied
    end

    update_reviewed_instructions(applied_sources)
  end

  def down
    restore_reviewed_instructions

    ContentBlock.find_each do |block|
      block.with_lock do
        metadata = block.metadata.to_h
        marker = metadata.fetch(OWNERSHIP_KEY, nil)
        next unless marker.is_a?(Hash)

        if metadata.slice(*MANAGED_KEYS) == marker.fetch("installed_values", {})
          restored = metadata.except(*MANAGED_KEYS, OWNERSHIP_KEY)
          marker.fetch("present_keys", []).each do |key|
            restored[key] = marker.fetch("values", {})[key]
          end
        else
          restored = metadata.except(OWNERSHIP_KEY)
        end
        block.update_columns(metadata: restored, updated_at: Time.current)
      end
    end
  end

  private

  def alumni_catalog
    @alumni_catalog ||= JSON.parse(File.read(CATALOG_PATH)).select do |entry|
      entry.fetch("review_method") == REVIEW_METHOD
    end
  end

  def update_reviewed_instructions(applied_sources)
    ContentBlock.where(lesson_id: applied_sources.keys).where.not(body: nil).find_each do |block|
      block.with_lock do
        metadata = block.metadata.to_h
        next if metadata.key?(INSTRUCTION_OWNERSHIP_KEY)

        updated_body = reviewed_instruction_body(block.body, applied_sources.fetch(block.lesson_id))
        next if updated_body.blank? || updated_body == block.body

        block.update_columns(
          body: updated_body,
          metadata: metadata.merge(
            INSTRUCTION_OWNERSHIP_KEY => { "body" => block.body, "installed_body" => updated_body }
          ),
          updated_at: Time.current
        )
      end
    end
  end

  def restore_reviewed_instructions
    ContentBlock.find_each do |block|
      block.with_lock do
        metadata = block.metadata.to_h
        marker = metadata.fetch(INSTRUCTION_OWNERSHIP_KEY, nil)
        next unless marker.is_a?(Hash) && marker.key?("body")

        block.update_columns(
          body: block.body == marker.fetch("installed_body", nil) ? marker.fetch("body") : block.body,
          metadata: metadata.except(INSTRUCTION_OWNERSHIP_KEY),
          updated_at: Time.current
        )
      end
    end
  end

  def reviewed_instruction_body(body, expected_source)
    fragment = Nokogiri::HTML.fragment(body)
    heading = fragment.css("h1, h2, h3, h4, h5, h6").find do |candidate|
      candidate.text.squish.casecmp?(PREVIOUS_HEADING)
    end
    return unless heading

    archive = heading.xpath("preceding-sibling::p").find do |paragraph|
      paragraph.text.squish.downcase.start_with?("class archive:") &&
        paragraph.css("a[href]").any? { |anchor| source_matches?(anchor["href"], expected_source) }
    end
    list = heading.xpath("following-sibling::*[1]").first
    return unless archive && timestamp_list?(list, expected_source)

    heading.content = REVIEWED_HEADING
    instruction = Nokogiri::XML::Node.new("p", fragment.document)
    instruction.content = REVIEWED_INSTRUCTION
    list.replace(instruction)
    fragment.to_html
  end

  def timestamp_list?(list, expected_source)
    return false unless list&.name.in?(%w[ul ol])

    items = list.xpath("./li")
    items.present? && items.all? do |item|
      anchors = item.css("a[href]")
      anchors.one? && anchors.first.text.match?(TIMESTAMP_RANGE) &&
        source_matches?(anchors.first["href"], expected_source) && timestamp_link?(anchors.first["href"])
    end
  end

  def timestamp_link?(url)
    uri = URI.parse(url.to_s)
    values = URI.decode_www_form(uri.query.to_s).to_h
    values.merge!(URI.decode_www_form(uri.fragment.to_s).to_h) if uri.fragment.to_s.include?("=")
    (values["t"] || values["start"]).to_s.match?(/\A\d+s?\z/)
  rescue URI::InvalidURIError, ArgumentError
    false
  end

  def source_matches?(url, expected)
    expected.blank? || recording_source_id(url) == expected
  end

  def recording_source_id(url)
    uri = URI.parse(url.to_s)
    host = uri.host.to_s.downcase.delete_prefix("www.")
    path = uri.path.to_s.split("/").reject(&:blank?)

    if host == "youtu.be"
      path.first
    elsif host == "youtube.com" || host.end_with?(".youtube.com") || host == "youtube-nocookie.com" || host.end_with?(".youtube-nocookie.com")
      return URI.decode_www_form(uri.query.to_s).to_h["v"] if path.first == "watch"
      path.second if %w[embed shorts live].include?(path.first)
    elsif host == "vimeo.com" || host.end_with?(".vimeo.com")
      path.first == "video" ? path.second : path.find { |part| part.match?(/\A\d+\z/) }
    end
  rescue URI::InvalidURIError, ArgumentError
    nil
  end
end
