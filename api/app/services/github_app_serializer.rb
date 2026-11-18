class GithubAppSerializer
  def self.installation(row)
    row.slice(:id, :cohort_id, :app_id, :installation_id, :account_id, :account_login, :account_type, :repository_selection, :permissions, :connection_state, :failure_reason, :connected_at, :checked_at)
  end

  def self.binding(row)
    data = row.slice(:id, :enrollment_id, :curriculum_module_id, :github_app_installation_id, :repository_id, :full_name, :github_username, :verification_state, :failure_reason, :verified_at, :checked_at)
    if data["verification_state"] == "verified" && !row.identity_current?
      data.merge!("verification_state" => "failed", "failure_reason" => "GitHub username changed; verify the repository again", "verified_at" => nil)
    end
    data
  end
end
