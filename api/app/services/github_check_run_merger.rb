class GithubCheckRunMerger
  STATUS_RANK = {
    "queued" => 0,
    "requested" => 0,
    "waiting" => 0,
    "pending" => 0,
    "in_progress" => 1,
    "completed" => 2
  }.freeze

  # Extract canonical "owner/repo" coordinates from a submission's GitHub URLs.
  # Returns nil if no valid HTTPS github.com URL is present, or if multiple
  # GitHub URLs on the submission disagree on the repository.
  def self.submission_repository_full_name(submission, require_consistent: false)
    coordinates = submission_github_repositories(submission)
    return nil if coordinates.empty?
    return nil if require_consistent && coordinates.map(&:downcase).uniq.size > 1

    coordinates.first
  end

  def self.submission_github_repositories(submission)
    [ submission.repo_url, submission.pr_url, submission.github_code_url ].compact_blank.filter_map do |value|
      uri = URI.parse(value)
      next unless uri.scheme == "https" && uri.host == "github.com"

      owner, repository = uri.path.split("/").reject(&:blank?).first(2)
      "#{owner}/#{repository.delete_suffix('.git')}" if owner.present? && repository.present?
    rescue URI::InvalidURIError
      nil
    end
  end

  def self.submission_matches_binding?(submission, binding:, payload_repo_full_name: nil)
    return false if binding.blank? || binding.full_name.blank? || binding.repository_id.blank?
    if payload_repo_full_name.present? && !binding.full_name.casecmp?(payload_repo_full_name)
      return false
    end

    # Require stored numeric repository provenance so legacy rows and replacement
    # repositories at the same owner/repo path stage safely rather than guessing.
    return false unless submission.github_repository_id.present? &&
      submission.github_repository_id.to_i == binding.repository_id.to_i

    full_name = submission_repository_full_name(submission, require_consistent: true)
    full_name.nil? || full_name.casecmp?(binding.full_name)
  end

  def self.regresses_existing_run?(run, status:, conclusion:, started_at:, completed_at:, changed_since_prefetch: false)
    existing_rank = STATUS_RANK.fetch(run.status, 0)
    incoming_rank = STATUS_RANK.fetch(status, 0)
    return true if incoming_rank < existing_rank

    # Reject a stale completion from an older attempt when a newer rerun is active.
    if incoming_rank > existing_rank
      return true if run.started_at.present? && started_at.present? && started_at < run.started_at

      return false
    end

    if run.status == "completed" && status == "completed"
      if run.completed_at.present?
        return true if completed_at.nil? || completed_at < run.completed_at
        if completed_at == run.completed_at
          return true if changed_since_prefetch
          return true if run.started_at.present? && started_at.present? && started_at < run.started_at
          return true if run.conclusion.present? && conclusion.nil?
        end
      elsif changed_since_prefetch && completed_at.nil?
        return true
      end
    else
      return true if run.started_at.present? && started_at.present? && started_at < run.started_at
    end

    false
  end

  def self.superseded_by_newer_same_name_run?(submission:, external_id:, head_sha:, name:, app_slug:, check_suite_id:, status:, completed_at:)
    return false unless check_suite_id.present?

    peers = submission.github_check_runs
      .where(head_sha: head_sha, name: name, app_slug: app_slug, check_suite_id: check_suite_id)
      .where.not(external_id: external_id)
      .where(status: "completed")
      .to_a
    return false if peers.empty?

    peers.any? do |peer|
      if status == "completed"
        peer.completed_at.present? && (completed_at.nil? || completed_at < peer.completed_at)
      else
        peer.external_id > external_id
      end
    end
  end

  # Must be called inside `submission.with_lock`.
  def self.upsert_locked!(submission:, attributes:, fetched_at:, check_superseded_peers: false, allow_rerun_reset: false, changed_since_prefetch: false)
    external_id = attributes.fetch(:external_id)
    head_sha = attributes.fetch(:head_sha)
    incoming_status = attributes.fetch(:status)
    incoming_conclusion = attributes[:conclusion]
    incoming_check_suite_id = positive_integer(attributes[:check_suite_id])
    incoming_started_at = parse_time(attributes[:started_at])
    incoming_completed_at = parse_time(attributes[:completed_at])

    run = submission.github_check_runs.find_or_initialize_by(external_id: external_id)
    rerun_reset = run.persisted? && allow_rerun_reset && run.status == "completed" &&
      incoming_status != "completed" && incoming_completed_at.nil?

    if run.persisted? && !rerun_reset
      if regresses_existing_run?(
        run,
        status: incoming_status,
        conclusion: incoming_conclusion,
        started_at: incoming_started_at,
        completed_at: incoming_completed_at,
        changed_since_prefetch: changed_since_prefetch
      )
        return run
      end
    elsif run.new_record? && check_superseded_peers && superseded_by_newer_same_name_run?(
      submission: submission,
      external_id: external_id,
      head_sha: head_sha,
      name: attributes.fetch(:name),
      app_slug: attributes[:app_slug],
      check_suite_id: incoming_check_suite_id,
      status: incoming_status,
      completed_at: incoming_completed_at
    )
      return nil
    end

    run.update!(
      name: attributes.fetch(:name),
      workflow_name: attributes[:workflow_name].presence || run.workflow_name,
      app_slug: attributes[:app_slug].presence || run.app_slug,
      check_suite_id: incoming_check_suite_id || run.check_suite_id,
      head_sha: head_sha,
      status: incoming_status,
      conclusion: incoming_conclusion,
      details_url: attributes[:details_url].presence || run.details_url,
      started_at: rerun_reset ? incoming_started_at : (incoming_started_at || run.started_at),
      completed_at: rerun_reset ? nil : (incoming_completed_at || run.completed_at),
      fetched_at: fetched_at
    )
    run
  end

  # Atomically merges a fetched GitHub check-run snapshot under `submission.with_lock`.
  # Protects runs created or updated since `pre_fetch_versions` (e.g. committed by a
  # concurrent webhook during the HTTP fetch) from being pruned or regressed, while
  # allowing legitimate GitHub rerun resets on rows untouched since pre-fetch.
  def self.sync_snapshot!(submission:, runs:, fetched_at:, pre_fetch_versions:, fetched_sha: nil)
    submission.with_lock do
      expected_sha = submission.commit_sha
      if fetched_sha.present? && expected_sha != fetched_sha
        return { check_runs: [], error: "Submission commit changed during refresh; retry to fetch latest checks" }
      end

      snapshot_external_ids = runs.map { |attrs| attrs.fetch("id") }
      existing_by_external_id = submission.github_check_runs
        .where(external_id: snapshot_external_ids)
        .index_by(&:external_id)

      runs.each do |attrs|
        external_id = attrs.fetch("id")
        existing = existing_by_external_id[external_id]
        unchanged_since_prefetch = existing.present? && pre_fetch_versions[existing.id] == {
          updated_at: existing.updated_at,
          status: existing.status,
          conclusion: existing.conclusion,
          completed_at: existing.completed_at
        }

        upsert_locked!(
          submission: submission,
          attributes: {
            external_id: external_id,
            name: attrs.fetch("name"),
            workflow_name: attrs.dig("check_suite", "app", "name"),
            app_slug: attrs.dig("app", "slug"),
            check_suite_id: attrs.dig("check_suite", "id"),
            head_sha: attrs.fetch("head_sha"),
            status: attrs.fetch("status"),
            conclusion: attrs["conclusion"],
            details_url: attrs["details_url"],
            started_at: attrs["started_at"],
            completed_at: attrs["completed_at"]
          },
          fetched_at: fetched_at,
          check_superseded_peers: false,
          allow_rerun_reset: unchanged_since_prefetch,
          changed_since_prefetch: existing.present? && !unchanged_since_prefetch
        )
      end

      obsolete_ids = submission.github_check_runs
        .where(head_sha: expected_sha)
        .select(:id, :external_id, :updated_at)
        .filter_map do |existing|
          next if snapshot_external_ids.include?(existing.external_id)
          next unless pre_fetch_versions.key?(existing.id)
          next if existing.updated_at != pre_fetch_versions[existing.id][:updated_at]

          existing.id
        end

      submission.github_check_runs.where(id: obsolete_ids).delete_all if obsolete_ids.any?

      imported = submission.github_check_runs
        .where(head_sha: expected_sha)
        .to_a
        .sort_by { |run| [ run.completed_at || Time.zone.at(0), run.id ] }
        .reverse
      { check_runs: imported, error: nil }
    end
  end

  def self.positive_integer(value)
    return value if value.is_a?(Integer) && value.positive? && value <= 9_223_372_036_854_775_807
    return nil unless value.is_a?(String) && value.match?(/\A[1-9]\d{0,18}\z/)

    int = value.to_i
    int <= 9_223_372_036_854_775_807 ? int : nil
  end

  def self.parse_time(value)
    return value if value.is_a?(Time) || value.is_a?(ActiveSupport::TimeWithZone)
    return nil unless value.is_a?(String) && value.present?

    Time.iso8601(value)
  rescue ArgumentError
    nil
  end
end
