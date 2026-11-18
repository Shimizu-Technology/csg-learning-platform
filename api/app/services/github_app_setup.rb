class GithubAppSetup
  PURPOSE = "github-app-installation".freeze

  def self.prepare(actor:, cohort:)
    raise ActiveRecord::RecordNotFound unless actor.admin? && GithubRepositoryAccess.enabled?(cohort)

    raise GithubAppClient::Error, "GitHub App credentials are not configured" unless GithubAppCredentials.configured?

    state = verifier.generate({ "actor_id" => actor.id, "cohort_id" => cohort.id, "app_id" => GithubAppCredentials.app_id }, purpose: PURPOSE, expires_in: 15.minutes)
    { state: state, installation_url: "https://github.com/apps/#{GithubAppCredentials.slug}/installations/new?state=#{ERB::Util.url_encode(state)}" }
  end

  def self.context(state:, actor:)
    value = verifier.verified(state.to_s, purpose: PURPOSE)
    unless value && value["actor_id"] == actor.id && value["app_id"] == GithubAppCredentials.app_id
      raise ActiveRecord::RecordNotFound
    end
    value
  end

  def self.connect(cohort:, installation_id:, client: GithubAppClient.new)
    raise ActiveRecord::RecordNotFound unless GithubRepositoryAccess.enabled?(cohort)

    raise GithubAppClient::Error, "Use a positive GitHub installation ID" unless installation_id.to_s.match?(/\A[1-9]\d{0,18}\z/) && installation_id.to_i <= 9_223_372_036_854_775_807

    data = client.installation(installation_id.to_i)
    row = cohort.github_app_installations.find_or_initialize_by(installation_id: installation_id)
    row.assign_attributes(app_id: data.fetch("app_id"), account_id: data.dig("account", "id"), account_login: data.dig("account", "login"),
      account_type: data.dig("account", "type"), repository_selection: data.fetch("repository_selection"), permissions: data.fetch("permissions", {}),
      connection_state: "connected", failure_reason: nil, connected_at: row.connected_at || Time.current, checked_at: Time.current)
    row.save!
    # Reconnection never silently re-verifies an old repository.
    row
  end

  def self.verifier = Rails.application.message_verifier(PURPOSE)
end
