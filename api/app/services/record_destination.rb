# Additive wire descriptor. Legacy paths remain available to installed clients.
class RecordDestination
  PATH_ALIASES = JSON.parse(File.read(Rails.root.join("config/record_destination_aliases.json"))).freeze
  CONTEXT_KEYS = {
    "student" => %w[cohort_id], "staff" => [], "curriculum" => %w[cohort_id], "resource" => %w[cohort_id],
    "cohort_file" => %w[cohort_id student_id],
    "lesson" => %w[cohort_id help_request], "module" => %w[cohort_id], "submission" => %w[cohort_id student_id],
    "help_request" => %w[cohort_id student_id], "follow_up" => [], "channel" => [], "dm" => [],
    "announcement" => %w[cohort_id], "recording" => %w[cohort_id],
    "meeting" => %w[cohort_id booking_id week], "cohort" => [],
    # Admin-only Safety items. Web only: native clients have no Safety page and fall back to Updates.
    "content_report" => [], "deletion_request" => []
  }.freeze
  # Kinds with no native screen. Installed builds that predate a kind also return nil for it.
  WEB_ONLY = %w[staff content_report deletion_request].freeze
  SAFETY_ANCHORS = { "report" => "content_report", "deletion" => "deletion_request" }.freeze

  def self.build(kind:, id: nil, context: {}, anchor: {})
    return unless CONTEXT_KEYS.key?(kind)

    valid_id = id.to_s.match?(/\A[1-9]\d*\z/) || (kind == "recording" && id.to_s.match?(/\Alegacy-[1-9]\d*-[1-9]\d*\z/))
    return unless valid_id || kind == "meeting"

    clean = context.stringify_keys.slice(*CONTEXT_KEYS.fetch(kind)).select { |_, value| value.to_s.match?(/\A[1-9]\d*\z/) }
    clean["query"] = context[:query].to_s.first(180) if kind == "resource" && context[:query].present?
    clean["staff"] = true if %w[meeting cohort curriculum cohort_file].include?(kind) && context[:staff] == true
    anchors = anchor.stringify_keys
    anchors["message_id"] ||= anchors.delete("messageId")
    allowed = kind == "lesson" ? %w[block_id] : %w[channel dm].include?(kind) ? %w[message_id] : []
    { kind: kind, id: id, context: clean, anchor: anchors.slice(*allowed).select { |_, value| value.to_s.match?(/\A[1-9]\d*\z/) } }
  end

  def self.from_path(path)
    return unless path.is_a?(String) && path.start_with?("/") && !path.match?(/[\s\\]/) && !path.start_with?("//")

    raw_uri = URI.parse(path)
    raw_groups = URI.decode_www_form(raw_uri.query.to_s).group_by(&:first)
    raw_params = raw_groups.filter_map { |key, entries| [ key, entries.first.last ] if entries.size == 1 }.to_h
    student_entries = raw_groups["student"]
    valid_student = student_entries.nil? || (student_entries.size == 1 && student_entries.first.last.to_s.match?(/\A[1-9]\d*\z/))
    if (cohort_files = raw_uri.path.match(%r{\A/admin/cohorts/([1-9]\d*)\z})) && raw_params["tab"] == "files" && raw_params["file"].to_s.match?(/\A[1-9]\d*\z/) && valid_student
      return build(kind: "cohort_file", id: raw_params["file"], context: { cohort_id: cohort_files[1], student_id: raw_params["student"], staff: true })
    end

    PATH_ALIASES.each do |entry|
      pattern = Regexp.new(entry.fetch("pattern"))
      base = path.split(/[?#]/).first
      next unless pattern.match?(base)

      captures = base.match(pattern)
      target = entry.fetch("replacement").gsub(/\$(\d+)/) { captures[Regexp.last_match(1).to_i] }
      source_uri = URI.parse(path)
      target_uri = URI.parse(target)
      fixed = URI.decode_www_form(target_uri.query.to_s)
      target_uri.query = URI.encode_www_form(fixed + URI.decode_www_form(source_uri.query.to_s).reject { |key, _| fixed.any? { |k, _| k == key } })
      result = from_path(target_uri.to_s)
      result[:context].merge!(entry.fetch("context", {})) if result
      return result
    end
    uri = URI.parse(path)
    params = URI.decode_www_form(uri.query.to_s).group_by(&:first).filter_map { |key, entries| [ key, entries.first.last ] if entries.size == 1 }.to_h
    patterns = {
      "lesson" => %r{\A/lessons/([1-9]\d*)\z}, "module" => %r{\A/modules/([1-9]\d*)\z},
      "submission" => %r{\A/admin/submissions/([1-9]\d*)\z}, "help_request" => %r{\A/admin/help-requests/([1-9]\d*)\z},
      "follow_up" => %r{\A/admin/interventions/([1-9]\d*)\z}, "dm" => %r{\A/messages/dm/([1-9]\d*)\z},
      "channel" => %r{\A/messages/([1-9]\d*)\z}, "announcement" => %r{\A/announcements/([1-9]\d*)\z}, "cohort" => %r{\A/cohorts/([1-9]\d*)\z},
      "student" => %r{\A/admin/students/([1-9]\d*)\z}, "staff" => %r{\A/admin/team/([1-9]\d*)\z}
    }
    patterns.each do |kind, pattern|
      match = uri.path.match(pattern)
      next unless match

      return build(kind: kind, id: match[1], context: params, anchor: {
        block_id: uri.fragment&.match(/\Ablock-([1-9]\d*)\z/)&.[](1) || params["block_id"],
        message_id: params["message_id"] || params["messageId"]
      })
    end
    if uri.path == "/admin/content" && (curriculum = uri.fragment&.match(/\Acurriculum-([1-9]\d*)\z/))
      build(kind: "curriculum", id: curriculum[1], context: params.merge(staff: true))
    elsif uri.path == "/admin/moderation" && (safety = uri.fragment&.match(/\A(report|deletion)-([1-9]\d*)\z/))
      build(kind: SAFETY_ANCHORS.fetch(safety[1]), id: safety[2])
    elsif uri.path == "/recordings" && params["recording"].to_s.match?(/\A(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)\z/)
      build(kind: "recording", id: params["recording"], context: params)
    elsif uri.path == "/resources" && params["file"].to_s.match?(/\A[1-9]\d*\z/)
      build(kind: "cohort_file", id: params["file"], context: params.slice("cohort_id"))
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

    if kind == "cohort_file"
      if clean[:context]["staff"] == true
        return unless clean[:context]["cohort_id"]

        params = { "tab" => "files" }
        params["student"] = clean[:context]["student_id"] if clean[:context]["student_id"]
        params["file"] = id
        return "/admin/cohorts/#{clean[:context]['cohort_id']}?#{URI.encode_www_form(params)}"
      end
      params = clean[:context].slice("cohort_id")
      params["file"] = id
      return "/resources?#{URI.encode_www_form(params)}"
    end

    paths = { "student" => "/admin/students/#{id}", "staff" => "/admin/team/#{id}", "curriculum" => clean[:context]["staff"] ? "/admin/content" : "/materials", "resource" => "/resources", "lesson" => "/lessons/#{id}", "module" => "/modules/#{id}", "submission" => "/admin/submissions/#{id}", "help_request" => "/admin/help-requests/#{id}", "follow_up" => "/admin/interventions/#{id}", "channel" => "/messages/#{id}", "dm" => "/messages/dm/#{id}", "announcement" => "/announcements/#{id}", "recording" => "/recordings", "meeting" => clean[:context]["staff"] ? "/admin/meetings" : "/meetings", "cohort" => clean[:context]["staff"] ? "/admin/cohorts/#{id}" : "/cohorts/#{id}", "content_report" => "/admin/moderation", "deletion_request" => "/admin/moderation" }
    params = clean[:context].except("staff", "query")
    params["recording"] = id if kind == "recording"
    params["resource"] = id if kind == "resource"
    params["q"] = clean[:context]["query"] if kind == "resource" && clean[:context]["query"]
    params["message_id"] = clean[:anchor]["message_id"] if clean[:anchor]["message_id"]
    path = paths.fetch(kind)
    path += "?#{URI.encode_www_form(params)}" if params.any?
    path += "#curriculum-#{id}" if kind == "curriculum" && clean[:context]["staff"]
    path += "#block-#{clean[:anchor]['block_id']}" if clean[:anchor]["block_id"]
    path += "#report-#{id}" if kind == "content_report"
    path += "#deletion-#{id}" if kind == "deletion_request"
    path
  end

  def self.to_native_href(descriptor)
    return if WEB_ONLY.include?(descriptor&.deep_symbolize_keys&.dig(:kind))

    path = to_web_path(descriptor)
    return unless path

    d = descriptor.deep_symbolize_keys
    id = d[:id]
    uri = URI.parse(path)
    params = URI.decode_www_form(uri.query.to_s).to_h
    if d[:kind] == "cohort_file"
      if d.dig(:context, :staff) == true
        native_params = {}
        native_params["cohort_id"] = d.dig(:context, :cohort_id).to_s if d.dig(:context, :cohort_id)
        native_params["student"] = params["student"] if params["student"]
        native_params["file"] = id.to_s
        return "/staff/files?#{URI.encode_www_form(native_params)}"
      end
      return path
    end
    paths = { "student" => "/staff/student/#{id}", "staff" => "/staff/team", "curriculum" => d.dig(:context, :staff) == true ? "/staff/curriculum/#{id}" : "/learn", "resource" => "/resources", "lesson" => "/lesson/#{id}", "module" => "/module/#{id}", "submission" => "/staff/submission/#{id}", "help_request" => "/staff/support/#{id}", "follow_up" => "/staff/intervention/#{id}", "channel" => "/conversation/channel/#{id}", "dm" => "/conversation/dm/#{id}", "announcement" => "/updates", "recording" => "/recording/#{id}", "meeting" => "/meetings", "cohort" => "/cohort/#{id}" }
    params.delete("recording")
    params["announcement_id"] = id if d[:kind] == "announcement"
    params["block_id"] = uri.fragment.delete_prefix("block-") if uri.fragment && d[:kind] == "lesson"
    base = paths.fetch(d[:kind])
    params.any? ? "#{base}?#{URI.encode_www_form(params)}" : base
  end
end
