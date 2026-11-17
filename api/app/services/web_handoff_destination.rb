# Public grammar shared with native fallback controls; authorization stays here too.
class WebHandoffDestination
  POLICY = JSON.parse(File.read(Rails.root.join("config/web_handoff_policy.json"))).freeze
  PATH = Regexp.new("\\A(?:#{POLICY.fetch('path_pattern')})\\z")
  RECORDING = Regexp.new("\\A(?:#{POLICY.fetch('recording_pattern')})\\z")

  def self.supported?(destination)
    path = destination.split(/[?#]/, 2).first.to_s
    return false unless PATH.match?(path) || RECORDING.match?(destination)
    return true unless path == "/admin/meetings"
    return false if destination.include?("#") || destination.count("?") > 1
    return true unless destination.include?("?")

    pairs = URI.decode_www_form(destination.partition("?").last)
    pairs.any? && pairs.map(&:first).uniq.length == pairs.length && pairs.all? { |key, value| POLICY.fetch("meeting_query_keys").include?(key) && value.match?(/\A[1-9]\d*\z/) }
  rescue ArgumentError
    false
  end
end
