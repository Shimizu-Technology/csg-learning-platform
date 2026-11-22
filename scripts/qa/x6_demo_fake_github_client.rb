# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "time"

# Local-only file-backed simulated GitHub App client for the X-6.10 synthetic
# Actualize prework demo harness. Loaded ONLY from scripts/qa/boot.rb when
# QA_X6_DEMO=1 (which requires RAILS_ENV=test, local loopback csg_qa_* DB, and
# LocalHTTPOnly blocking all non-loopback HTTP).
#
# Never touches real GitHub APIs, real credentials, or real student repos.
# Every simulated issue URL and check details URL uses example.invalid so it
# cannot be mistaken for a live GitHub provider receipt.
class X6DemoFakeGithubClient
  STATE_ENV_KEY = "QA_X6_DEMO_STATE"

  def self.state_path
    ENV[STATE_ENV_KEY].presence || File.expand_path("../../.qa-local/x6-demo-provider-state.json", __dir__)
  end

  def self.lock_path
    "#{state_path}.lock"
  end

  def self.default_state
    {
      "simulated" => true,
      "provider_label" => "simulated-local-github-app",
      "outage" => {
        "enabled" => false,
        "mode" => "transient",
        "message" => "Simulated GitHub provider outage (503)"
      },
      "timeout_after_create_once" => false,
      "next_issue_number" => 1,
      "next_comment_id" => 1,
      "installations" => {},
      "repositories" => {},
      "issues" => {},
      "audit_log" => []
    }
  end

  def self.with_state(write: false)
    FileUtils.mkdir_p(File.dirname(state_path))
    File.open(lock_path, File::RDWR | File::CREAT, 0o600) do |lock|
      lock.flock(write ? File::LOCK_EX : File::LOCK_SH)
      state = if File.exist?(state_path)
        JSON.parse(File.read(state_path))
      else
        default_state
      end
      result = yield(state)
      if write
        tmp = "#{state_path}.tmp.#{Process.pid}"
        File.write(tmp, JSON.pretty_generate(state))
        File.rename(tmp, state_path)
      end
      result
    end
  end

  def self.reset_state!(initial_state = nil)
    FileUtils.mkdir_p(File.dirname(state_path))
    File.open(lock_path, File::RDWR | File::CREAT, 0o600) do |lock|
      lock.flock(File::LOCK_EX)
      payload = default_state.merge(initial_state || {})
      tmp = "#{state_path}.tmp.#{Process.pid}"
      File.write(tmp, JSON.pretty_generate(payload))
      File.rename(tmp, state_path)
      payload
    end
  end

  def installation(id, timeout: nil)
    self.class.with_state(write: true) do |state|
      record_call(state, "installation", id: id.to_i)
      maybe_raise_outage!(state, scope: :general)
      entry = state.dig("installations", id.to_s)
      raise GithubAppClient::Error.new("Simulated installation #{id} not found", status: 404) unless entry

      entry
    end
  end

  def repository(installation:, full_name:, repository_id: nil, timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    self.class.with_state(write: true) do |state|
      record_call(state, "repository", installation_id: installation.id, full_name: full_name, repository_id: repository_id)
      maybe_raise_outage!(state, scope: :general)
      repo = find_repository(state, repository_id: repository_id, full_name: full_name)
      unless repo
        raise GithubAppClient::Error.new(
          "GitHub installation cannot access this repository; check selected repositories and reconnect",
          status: 422
        )
      end

      {
        "id" => repo.fetch("id"),
        "full_name" => repo.fetch("full_name"),
        "fork" => repo["fork"] == true,
        "owner" => repo.fetch("owner")
      }
    end
  end

  def default_branch_head(installation:, repository:, timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    self.class.with_state(write: true) do |state|
      repo_id = repository.fetch("id").to_i
      record_call(state, "default_branch_head", installation_id: installation.id, repository_id: repo_id)
      maybe_raise_outage!(state, scope: :general)
      repo = find_repository(state, repository_id: repo_id, full_name: repository["full_name"])
      raise GithubAppClient::Error, "GitHub repository has no submitted commit" unless repo && repo["head_sha"].present?

      committed_at = repo["committed_at"].present? ? Time.iso8601(repo["committed_at"]) : Time.current
      {
        commit_hash: repo.fetch("head_sha"),
        branch: repo["branch"] || "main",
        committed_at: committed_at
      }
    end
  end

  def files(installation:, repository:, filenames:, workflow_paths: [], timeout: nil)
    head = default_branch_head(installation: installation, repository: repository, timeout: timeout)
    files_at_commit(
      installation: installation,
      repository: repository,
      sha: head.fetch(:commit_hash),
      branch: head.fetch(:branch),
      filenames: filenames,
      workflow_paths: workflow_paths,
      timeout: timeout
    )
  end

  def files_at_commit(installation:, repository:, sha:, branch:, filenames:, workflow_paths: [], timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    self.class.with_state(write: true) do |state|
      repo_id = repository.fetch("id").to_i
      record_call(state, "files_at_commit", installation_id: installation.id, repository_id: repo_id, sha: sha, filenames: filenames)
      maybe_raise_outage!(state, scope: :general)
      repo = find_repository(state, repository_id: repo_id, full_name: repository["full_name"])
      raise GithubAppClient::Error.new("Simulated repository not found", status: 404) unless repo

      commit = repo.dig("commits", sha) || repo.dig("commits", repo["head_sha"]) || {}
      file_map = commit["files"] || {}
      workflow_map = commit["workflow_files"] || {}

      resolved_files = Array(filenames).filter_map do |name|
        match_key = file_map.keys.find { |k| k.casecmp?(name) }
        next unless match_key && file_map[match_key].is_a?(String)

        { "name" => name, "text" => file_map[match_key] }
      end

      captured_workflows = Array(workflow_paths).each_with_object({}) do |wf_path, hash|
        entry = workflow_map[wf_path]
        if entry.nil?
          hash[wf_path] = { "present" => false }
        else
          text = entry.fetch("text", "")
          hash[wf_path] = {
            "present" => true,
            "oid" => entry.fetch("oid", Digest::SHA1.hexdigest("blob #{text.bytesize}\0#{text}")),
            "sha256" => entry.fetch("sha256", Digest::SHA256.hexdigest(text))
          }
        end
      end

      {
        files: resolved_files,
        workflow_files: captured_workflows,
        commit_hash: sha,
        branch: branch || repo["branch"] || "main",
        error: nil
      }
    end
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:, timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    self.class.with_state(write: true) do |state|
      record_call(state, "checks", installation_id: installation.id, repository_id: repository_id.to_i, sha: sha, page: page)
      maybe_raise_outage!(state, scope: :general)
      repo = find_repository(state, repository_id: repository_id, full_name: full_name)
      runs = repo ? Array(repo.dig("commits", sha, "checks")) : []
      per_page = 100
      slice = runs.slice((page - 1) * per_page, per_page) || []
      { "total_count" => runs.size, "check_runs" => slice }
    end
  end

  def workflow_paths_by_check_suite(installation:, repository_id:, full_name:, head_sha:, max_pages: GithubAppClient::WORKFLOW_RUNS_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    self.class.with_state(write: true) do |state|
      record_call(
        state,
        "workflow_paths_by_check_suite",
        installation_id: installation.id,
        repository_id: repository_id.to_i,
        head_sha: head_sha,
        max_pages: max_pages
      )
      maybe_raise_outage!(state, scope: :general)
      repo = find_repository(state, repository_id: repository_id, full_name: full_name)
      commit = repo&.dig("commits", head_sha) || {}
      explicit_map = commit["workflow_paths_by_check_suite"]
      result = {}
      if explicit_map.is_a?(Hash)
        explicit_map.each { |suite_id, wf_path| result[suite_id.to_i] = wf_path if wf_path.present? }
      end
      Array(commit["checks"]).each do |run|
        suite_id = run.dig("check_suite", "id")
        wf_path = run["workflow_path"].presence || run.dig("check_suite", "workflow_path").presence
        result[suite_id.to_i] ||= wf_path if suite_id.present? && wf_path.present?
      end
      result
    end
  end

  def find_issue_by_marker(installation:, repository_id:, full_name:, marker:, issue_number: nil, max_pages: GithubAppClient::MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    found = find_issue_by_markers(
      installation: installation,
      repository_id: repository_id,
      full_name: full_name,
      markers: [ marker ],
      issue_number: issue_number,
      max_pages: max_pages,
      timeout: timeout,
      deadline: deadline,
      monotonic: monotonic
    )
    found&.except("matched_marker")
  end

  def find_issue_by_markers(installation:, repository_id:, full_name:, markers:, issue_number: nil, max_pages: GithubAppClient::MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    check_deadline!(deadline, monotonic)
    marker_list = Array(markers)
    self.class.with_state(write: true) do |state|
      record_call(state, "find_issue_by_markers", installation_id: installation.id, repository_id: repository_id.to_i, issue_number: issue_number)
      maybe_raise_outage!(state, scope: :issues)
      repo_issues = state.dig("issues", repository_id.to_s) || {}
      if issue_number
        issue = repo_issues[issue_number.to_s]
        return nil unless issue

        matched_comment_marker = nil
        Array(issue["comments"]).each do |comment|
          matched_comment_marker = marker_list.find { |m| comment["body"].to_s.include?(m) }
          break if matched_comment_marker
        end
        return issue_hash(issue).merge("matched_comment" => true, "matched_marker" => matched_comment_marker) if matched_comment_marker

        body_marker = marker_list.find { |m| issue["body"].to_s.include?(m) }
        return issue_hash(issue).merge("matched_marker" => body_marker) if body_marker

        return nil
      end

      repo_issues.each_value do |issue|
        matched_marker = marker_list.find { |m| issue["body"].to_s.include?(m) }
        return issue_hash(issue).merge("matched_marker" => matched_marker) if matched_marker
      end
      nil
    end
  end

  def create_issue(installation:, repository_id:, full_name:, title:, body:, timeout: nil)
    timed_out = false
    created = self.class.with_state(write: true) do |state|
      record_call(state, "create_issue", installation_id: installation.id, repository_id: repository_id.to_i, full_name: full_name, title: title)
      maybe_raise_outage!(state, scope: :issues)

      num = state["next_issue_number"].to_i
      num = 1 if num <= 0
      state["next_issue_number"] = num + 1
      issue = {
        "number" => num,
        "html_url" => "https://example.invalid/simulated-github/#{full_name}/issues/#{num}",
        "state" => "open",
        "simulated" => true,
        "title" => title,
        "body" => body,
        "created_at" => Time.current.iso8601,
        "comments" => []
      }
      state["issues"][repository_id.to_s] ||= {}
      state["issues"][repository_id.to_s][num.to_s] = issue

      if state["timeout_after_create_once"] == true
        state["timeout_after_create_once"] = false
        timed_out = true
      end
      issue
    end

    if timed_out
      raise GithubAppClient::Error, GithubAppClient::PROVIDER_ERROR
    end

    issue_hash(created)
  end

  def get_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    self.class.with_state(write: true) do |state|
      record_call(state, "get_issue", installation_id: installation.id, repository_id: repository_id.to_i, issue_number: issue_number.to_i)
      maybe_raise_outage!(state, scope: :issues)
      issue = state.dig("issues", repository_id.to_s, issue_number.to_s)
      raise GithubAppClient::Error.new("Simulated issue ##{issue_number} not found", status: 404) unless issue

      issue_hash(issue).merge("title" => issue["title"], "body" => issue["body"])
    end
  end

  def reopen_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    self.class.with_state(write: true) do |state|
      record_call(state, "reopen_issue", installation_id: installation.id, repository_id: repository_id.to_i, issue_number: issue_number.to_i)
      maybe_raise_outage!(state, scope: :issues)
      issue = state.dig("issues", repository_id.to_s, issue_number.to_s)
      raise GithubAppClient::Error.new("Simulated issue ##{issue_number} not found", status: 404) unless issue

      issue["state"] = "open"
      issue_hash(issue)
    end
  end

  def add_issue_comment(installation:, repository_id:, full_name:, issue_number:, body:, timeout: nil)
    self.class.with_state(write: true) do |state|
      record_call(state, "add_issue_comment", installation_id: installation.id, repository_id: repository_id.to_i, issue_number: issue_number.to_i)
      maybe_raise_outage!(state, scope: :issues)
      issue = state.dig("issues", repository_id.to_s, issue_number.to_s)
      raise GithubAppClient::Error.new("Simulated issue ##{issue_number} not found", status: 404) unless issue

      comment_id = state["next_comment_id"].to_i
      comment_id = 1 if comment_id <= 0
      state["next_comment_id"] = comment_id + 1
      issue["comments"] ||= []
      issue["comments"] << { "id" => comment_id, "body" => body, "created_at" => Time.current.iso8601 }
      { "id" => comment_id, "html_url" => "#{issue['html_url']}#issuecomment-#{comment_id}" }
    end
  end

  def close_issue(installation:, repository_id:, full_name:, issue_number:, comment: nil, timeout: nil)
    add_issue_comment(
      installation: installation,
      repository_id: repository_id,
      full_name: full_name,
      issue_number: issue_number,
      body: comment,
      timeout: timeout
    ) if comment.present?

    self.class.with_state(write: true) do |state|
      record_call(state, "close_issue", installation_id: installation.id, repository_id: repository_id.to_i, issue_number: issue_number.to_i)
      maybe_raise_outage!(state, scope: :issues)
      issue = state.dig("issues", repository_id.to_s, issue_number.to_s)
      raise GithubAppClient::Error.new("Simulated issue ##{issue_number} not found", status: 404) unless issue

      issue["state"] = "closed"
      issue["closed_at"] = Time.current.iso8601
      issue_hash(issue)
    end
  end

  private

  def check_deadline!(deadline, monotonic)
    return unless deadline

    clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
    raise GithubAppClient::BudgetExceeded, "GitHub request budget exhausted" if deadline - clock.call <= 0
  end

  def find_repository(state, repository_id:, full_name:)
    repos = state["repositories"] || {}
    return repos[repository_id.to_s] if repository_id.present? && repos.key?(repository_id.to_s)

    repos.values.find { |entry| entry["full_name"].to_s.casecmp?(full_name.to_s) }
  end

  def maybe_raise_outage!(state, scope:)
    outage = state["outage"]
    return unless outage.is_a?(Hash) && outage["enabled"] == true

    mode = outage["mode"].to_s
    message = outage["message"].presence || GithubAppClient::PROVIDER_ERROR

    case mode
    when "issue_transient"
      return unless scope == :issues

      raise GithubAppClient::Error.new(message, status: 503)
    when "issue_failed"
      return unless scope == :issues

      raise GithubAppClient::Error.new(message, status: 422)
    when "transient"
      raise GithubAppClient::Error.new(message, status: 503)
    when "permanent"
      raise GithubAppClient::Error.new(message, status: 422)
    end
  end

  def record_call(state, op, details = {})
    state["audit_log"] ||= []
    state["audit_log"] << {
      "at" => Time.current.iso8601,
      "simulated" => true,
      "op" => op
    }.merge(details.transform_keys(&:to_s))
    state["audit_log"] = state["audit_log"].last(200)
  end

  def issue_hash(issue)
    { "number" => issue.fetch("number"), "html_url" => issue.fetch("html_url"), "state" => issue.fetch("state") }
  end
end
