class GithubRepositoryAccess
  class BindingChanged < GithubAppClient::Error; end

  def self.enabled?(cohort, school: nil)
    cohort.present? && FeatureSwitches.for(cohort: cohort, school: school)["github_app"] == true
  end

  def self.binding_for(enrollment:, curriculum_module_id:)
    association = enrollment.association(:github_repository_bindings)
    rows = association.loaded? ? association.target : enrollment.github_repository_bindings.includes(:github_app_installation, :curriculum_module).to_a
    rows.each { |row| row.enrollment = enrollment }
    rows.find { |row| row.curriculum_module_id == curriculum_module_id } || rows.find { |row| row.curriculum_module_id.nil? }
  end

  def initialize(binding, client: GithubAppClient.new)
    @binding, @client = binding, client
  end

  def verify!
    check_gate!
    version = @binding.updated_at
    repo = @client.repository(installation: @binding.github_app_installation, full_name: @binding.full_name, repository_id: @binding.repository_id)
    # No provider I/O under the row lock. A concurrent edit must not inherit
    # verification for the old name, installation or learner identity.
    @binding.with_lock do
      raise BindingChanged, "Repository changed during verification; reload and verify again" unless @binding.updated_at == version

      user = @binding.enrollment.user.reload
      username = user.github_verified_login.to_s
      unless user.github_identity_verified? && @binding.github_app_installation.account_type == "User" && @binding.github_app_installation.account_id.to_s == user.github_user_id &&
          repo.dig("owner", "type") == "User" && repo.dig("owner", "id").to_s == user.github_user_id && username.casecmp?(repo.dig("owner", "login").to_s)
        raise GithubAppClient::Error, "Repository must belong to the learner's verified GitHub identity and personal installation"
      end
      raise GithubAppClient::Error, "Forked repositories are not accepted; submit from an original personal repository" if repo["fork"] == true
      if @binding.repository_id && @binding.repository_id != repo.fetch("id").to_i
        raise GithubAppClient::Error, "Repository identity changed; reconnect the repository"
      end
      # Renames/transfers require explicit confirmation of the new name.
      unless @binding.full_name.casecmp?(repo.fetch("full_name"))
        raise GithubAppClient::Error, "Repository moved or was renamed; save its current name and verify again"
      end
      @binding.update!(repository_id: repo.fetch("id"), github_user_id: user.github_user_id, github_username: username, verification_state: "verified", failure_reason: nil, verified_at: Time.current, checked_at: Time.current)
    end
    repo
  rescue BindingChanged
    raise
  rescue GithubAppClient::Error => error
    record_failure(error, version: version)
    raise
  end

  def repository!
    check_gate!
    unless @binding.verification_state == "verified" && @binding.identity_current? && @binding.repository_id.present?
      raise GithubAppClient::Error, "Repository verification required; verify the learner's GitHub identity and access again"
    end
    # Recheck numeric identity/access on each manual operation; no scheduled
    # background reconciliation is introduced by this slice.
    verify!
  rescue BindingChanged
    raise
  rescue GithubAppClient::Error => error
    record_failure(error, version: @binding.updated_at) if @binding.verification_state == "verified"
    raise
  end

  def fail_current_verification!(error)
    record_failure(error, version: @binding.updated_at)
  end

  private

  def check_gate!
    raise GithubAppClient::Error, "GitHub App is disabled for this cohort" unless self.class.enabled?(@binding.enrollment.cohort)
    unless @binding.enrollment.active? && !@binding.enrollment.user.archived? && !@binding.enrollment.user.invite_pending?
      raise GithubAppClient::Error, "Repository access requires an active learner enrollment"
    end
    user = @binding.enrollment.user
    raise GithubAppClient::Error, "Connect GitHub to prove the learner's identity before verifying a repository" unless user.github_identity_verified?
    unless @binding.github_app_installation.account_type == "User" && @binding.github_app_installation.account_id.to_s == user.github_user_id
      raise GithubAppClient::Error, "Only the learner's own personal GitHub installation can be used; organization installations are not accepted"
    end
    raise GithubAppClient::Error, "Reconnect the GitHub installation before verifying" unless @binding.github_app_installation.connection_state == "connected"
    unless @binding.github_app_installation.cohort_id == @binding.enrollment.cohort_id && (!@binding.curriculum_module || @binding.curriculum_module.curriculum_id == @binding.enrollment.cohort.curriculum_id)
      raise GithubAppClient::Error, "Repository binding is outside this cohort"
    end
  end

  def record_failure(error, version:)
    return unless self.class.enabled?(@binding.enrollment.cohort)

    @binding.with_lock do
      return if version && @binding.updated_at != version

      @binding.fail_verification!(error.message)
    end
    @binding.github_app_installation.fail_connection!(error.message) if error.status == 401
  end
end
