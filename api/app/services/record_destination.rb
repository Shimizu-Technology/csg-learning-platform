# Additive wire descriptor. Legacy paths remain available to installed clients.
class RecordDestination
  CONTEXT_KEYS = {
    "student" => [], "staff" => [], "curriculum" => %w[cohort_id], "resource" => %w[cohort_id],
    "lesson" => %w[cohort_id], "module" => %w[cohort_id], "submission" => %w[cohort_id student_id],
    "help_request" => [], "follow_up" => [], "channel" => [], "dm" => [],
    "announcement" => [], "recording" => %w[cohort_id],
    "meeting" => %w[cohort_id booking_id week], "cohort" => []
  }.freeze

  def self.build(kind:, id: nil, context: {}, anchor: {})
    return unless CONTEXT_KEYS.key?(kind)

    valid_id = id.to_s.match?(/\A[1-9]\d*\z/) || (kind == "recording" && id.to_s.match?(/\Alegacy-[1-9]\d*-[1-9]\d*\z/))
    return unless valid_id || kind == "meeting"

    clean = context.stringify_keys.slice(*CONTEXT_KEYS.fetch(kind)).select { |_, value| value.to_s.match?(/\A[1-9]\d*\z/) }
    clean["query"] = context[:query].to_s.first(180) if kind == "resource" && context[:query].present?
    clean["staff"] = true if %w[meeting cohort curriculum].include?(kind) && context[:staff] == true
    anchors = anchor.stringify_keys
    anchors["message_id"] ||= anchors.delete("messageId")
    allowed = kind == "lesson" ? %w[block_id] : %w[channel dm].include?(kind) ? %w[message_id] : []
    { kind: kind, id: id, context: clean, anchor: anchors.slice(*allowed).select { |_, value| value.to_s.match?(/\A[1-9]\d*\z/) } }
  end

  def self.from_path(path)
    return unless path.is_a?(String) && path.start_with?("/") && !path.match?(/[\s\\]/) && !path.start_with?("//")

    uri = URI.parse(path)
    params = URI.decode_www_form(uri.query.to_s).group_by(&:first).filter_map { |key, entries| [ key, entries.first.last ] if entries.size == 1 }.to_h
    patterns = {
      "lesson" => %r{\A/lessons/([1-9]\d*)\z}, "module" => %r{\A/modules/([1-9]\d*)\z},
      "submission" => %r{\A/admin/submissions/([1-9]\d*)\z}, "help_request" => %r{\A/admin/help-requests/([1-9]\d*)\z},
      "follow_up" => %r{\A/admin/interventions/([1-9]\d*)\z}, "dm" => %r{\A/messages/dm/([1-9]\d*)\z},
      "channel" => %r{\A/messages/([1-9]\d*)\z}, "announcement" => %r{\A/announcements/([1-9]\d*)\z}, "cohort" => %r{\A/cohorts/([1-9]\d*)\z}
    }
    patterns.each do |kind, pattern|
      match = uri.path.match(pattern)
      next unless match

      return build(kind: kind, id: match[1], context: params, anchor: {
        block_id: uri.fragment&.match(/\Ablock-([1-9]\d*)\z/)&.[](1) || params["block_id"],
        message_id: params["message_id"] || params["messageId"]
      })
    end
    if uri.path == "/recordings" && params["recording"].to_s.match?(/\A(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)\z/)
      build(kind: "recording", id: params["recording"], context: params)
    elsif %w[/meetings /admin/meetings].include?(uri.path)
      build(kind: "meeting", id: params["booking_id"], context: params.merge(staff: uri.path.start_with?("/admin")))
    end
  rescue URI::InvalidURIError, ArgumentError
    nil
  end

  def self.to_web_path(descriptor)
    return unless descriptor

    d = descriptor.deep_symbolize_keys
    kind, id = d.values_at(:kind, :id)
    clean = build(kind: kind, id: id, context: d[:context] || {}, anchor: d[:anchor] || {})
    return unless clean

    paths = { "student" => "/admin/students/#{id}", "staff" => "/admin/team#staff-#{id}", "curriculum" => clean[:context]["staff"] ? "/admin/content" : "/materials", "resource" => "/resources", "lesson" => "/lessons/#{id}", "module" => "/modules/#{id}", "submission" => "/admin/submissions/#{id}", "help_request" => "/admin/help-requests/#{id}", "follow_up" => "/admin/interventions/#{id}", "channel" => "/messages/#{id}", "dm" => "/messages/dm/#{id}", "announcement" => "/announcements/#{id}", "recording" => "/recordings", "meeting" => clean[:context]["staff"] ? "/admin/meetings" : "/meetings", "cohort" => clean[:context]["staff"] ? "/admin/cohorts/#{id}" : "/cohorts/#{id}" }
    params = clean[:context].except("staff", "query")
    params["recording"] = id if kind == "recording"
    params["resource"] = id if kind == "resource"
    params["q"] = clean[:context]["query"] if kind == "resource" && clean[:context]["query"]
    params["message_id"] = clean[:anchor]["message_id"] if clean[:anchor]["message_id"]
    path = paths.fetch(kind)
    path += "?#{URI.encode_www_form(params)}" if params.any?
    path += "#curriculum-#{id}" if kind == "curriculum" && clean[:context]["staff"]
    path += "#block-#{clean[:anchor]['block_id']}" if clean[:anchor]["block_id"]
    path
  end

  def self.to_native_href(descriptor)
    return if descriptor&.deep_symbolize_keys&.dig(:kind) == "staff"

    path = to_web_path(descriptor)
    return unless path

    d = descriptor.deep_symbolize_keys
    id = d[:id]
    uri = URI.parse(path)
    params = URI.decode_www_form(uri.query.to_s).to_h
    paths = { "student" => "/staff/student/#{id}", "staff" => "/staff/team", "curriculum" => d.dig(:context, :staff) == true ? "/staff/curriculum/#{id}" : "/learn", "resource" => "/resources", "lesson" => "/lesson/#{id}", "module" => "/module/#{id}", "submission" => "/staff/submission/#{id}", "help_request" => "/staff/support/#{id}", "follow_up" => "/staff/intervention/#{id}", "channel" => "/conversation/channel/#{id}", "dm" => "/conversation/dm/#{id}", "announcement" => "/updates", "recording" => "/recording/#{id}", "meeting" => "/meetings", "cohort" => "/cohort/#{id}" }
    params.delete("recording")
    params["announcement_id"] = id if d[:kind] == "announcement"
    params["block_id"] = uri.fragment.delete_prefix("block-") if uri.fragment && d[:kind] == "lesson"
    base = paths.fetch(d[:kind])
    params.any? ? "#{base}?#{URI.encode_www_form(params)}" : base
  end
end
