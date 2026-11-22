class GithubAppSerializer
  def self.installation(row)
    row.slice(:id, :cohort_id, :app_id, :installation_id, :account_id, :account_login, :account_type, :repository_selection, :permissions, :connection_state, :failure_reason, :connected_at, :checked_at)
  end

  def self.identity(user)
    { id: user.github_user_id, login: user.github_verified_login, verified_at: user.github_verified_at }
  end

  def self.binding(row, include_reconciliation: false)
    data = row.slice(:id, :enrollment_id, :curriculum_module_id, :github_app_installation_id, :repository_id, :full_name, :github_user_id, :github_username, :verification_state, :failure_reason, :verified_at, :checked_at)
    if data["verification_state"] == "verified" && !row.identity_current?
      data.merge!("verification_state" => "failed", "failure_reason" => "GitHub identity is unverified or changed; connect GitHub and verify the repository again", "verified_at" => nil)
    end
    if include_reconciliation
      state = row.github_reconciliation_state
      data.merge!(
        "last_reconciled_at" => state&.last_reconciled_at,
        "last_status" => state&.last_status || "idle",
        "last_error" => state&.last_error,
        "next_reconcile_at" => state&.next_reconcile_at
      )
    end
    data
  end
end
