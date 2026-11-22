class GithubCheckRunSerializer
  # Note: `workflow_path` is persisted internally on `github_check_runs` for
  # X-6.4 / AS-11 run-to-workflow policy provenance (pinning `expected_workflow_path`
  # requires each credited check run to prove its matching `workflow_path`) and is
  # surfaced inside `submission_grade_suggestions.evidence`, keeping this public
  # check-run payload backward-compatible with existing web and mobile clients.
  def self.collection_json(submission)
    runs = if submission.commit_sha.present?
      submission.github_check_runs.current_for(submission).recent_first.to_a
    else
      []
    end

    {
      head_sha: submission.commit_sha,
      fetched_at: runs.filter_map(&:fetched_at).max,
      summary: {
        total: runs.size,
        passed: runs.count(&:passed?),
        failed: runs.count(&:failed?),
        pending: runs.count(&:pending?),
        neutral: runs.count { |run| !run.passed? && !run.failed? && !run.pending? }
      },
      runs: runs.map { |run| run_json(run) }
    }
  end

  def self.run_json(run)
    {
      id: run.id,
      external_id: run.external_id,
      name: run.name,
      workflow_name: run.workflow_name,
      app_slug: run.app_slug,
      head_sha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      details_url: run.details_url,
      started_at: run.started_at,
      completed_at: run.completed_at,
      fetched_at: run.fetched_at
    }
  end
end
