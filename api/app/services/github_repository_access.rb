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

  # A local read of saved verification. Source sync still checks GitHub before
  # using a repository and checks the operation generation again before writing.
  def saved_verification_current?
    check_gate!
    @binding.verification_state == "verified" && @binding.repository_id.present? &&
      @binding.verified_at.present? && @binding.identity_current?
  rescue GithubAppClient::Error
    false
  end

  def initialize(binding, client: GithubAppClient.new)
    @binding, @client = binding, client
    @operation = nil
  end

  def verify!(timeout: nil, deadline: nil, monotonic: nil)
    verify_repository!(require_verified: false, timeout: timeout, deadline: deadline, monotonic: monotonic)
  end

  def repository!(timeout: nil, deadline: nil, monotonic: nil)
    verify_repository!(require_verified: true, timeout: timeout, deadline: deadline, monotonic: monotonic)
  end

  # Keep this same access object through source/check provider I/O. Its snapshot
  # is the operation's generation, never a freshly reloaded replacement's.
  def fail_current_verification!(error)
    return if error.is_a?(GithubAppClient::Error) && error.transient?

    record_failure(error, operation: @operation) if @operation
  end

  # Called after source I/O inside the enrollment write guard. Rebinds use that
  # guard too; installation mutations use this same installation/binding order.
  # No provider I/O occurs while these locks are held.
  def with_current_operation
    operation = @operation
    raise BindingChanged, "Repository verification required" unless operation

    operation[:installation].with_lock do
      @binding.with_lock do
        raise BindingChanged, "Repository changed during source sync; reload and sync again" unless operation_current?(operation)

        @binding.enrollment.user.reload
        check_gate!
        unless @binding.verification_state == "verified" && @binding.identity_current?
          raise BindingChanged, "Repository changed during source sync; reload and sync again"
        end
        yield
      end
    end
  end

  private

  def capture_operation(refresh_installation: false)
    installation = @binding.github_app_installation
    installation.reload if refresh_installation
    { binding_version: @binding.updated_at, binding_state: @binding.verification_state, installation: installation,
      installation_generation: installation.connection_generation, installation_state: installation.connection_state }.freeze
  end

  def verify_repository!(require_verified:, timeout: nil, deadline: nil, monotonic: nil)
    operation = @operation = capture_operation(refresh_installation: true)
    check_gate!
    if require_verified && !(@binding.verification_state == "verified" && @binding.identity_current? && @binding.repository_id.present?)
      raise GithubAppClient::Error, "Repository verification required; verify the learner's GitHub identity and access again"
    end
    repo = if deadline
      @client.repository(
        installation: operation[:installation],
        full_name: @binding.full_name,
        repository_id: @binding.repository_id,
        timeout: timeout,
        deadline: deadline,
        monotonic: monotonic
      )
    elsif timeout
      @client.repository(installation: operation[:installation], full_name: @binding.full_name, repository_id: @binding.repository_id, timeout: timeout)
    else
      @client.repository(installation: operation[:installation], full_name: @binding.full_name, repository_id: @binding.repository_id)
    end
    # No HTTP under locks. Every connection/binding mutation uses installation
    # then binding lock order, with the pre-I/O generations held separately.
    operation[:installation].with_lock do
      @binding.with_lock do
        raise BindingChanged, "Repository changed during verification; reload and verify again" unless operation_current?(operation)

        user = @binding.enrollment.user.reload
        username = user.github_verified_login.to_s
        unless user.github_identity_verified? && operation[:installation].account_type == "User" && operation[:installation].account_id.to_s == user.github_user_id &&
            repo.dig("owner", "type") == "User" && repo.dig("owner", "id").to_s == user.github_user_id && username.casecmp?(repo.dig("owner", "login").to_s)
          raise GithubAppClient::Error, "Repository must belong to the learner's verified GitHub identity and personal installation"
        end
        raise GithubAppClient::Error, "Forked repositories are not accepted; submit from an original personal repository" if repo["fork"] == true
        if @binding.repository_id && @binding.repository_id != repo.fetch("id").to_i
          raise GithubAppClient::Error, "Repository identity changed; reconnect the repository"
        end
        unless @binding.full_name.casecmp?(repo.fetch("full_name"))
          raise GithubAppClient::Error, "Repository moved or was renamed; save its current name and verify again"
        end
        @binding.update!(repository_id: repo.fetch("id"), github_user_id: user.github_user_id, github_username: username, verification_state: "verified", failure_reason: nil, verified_at: Time.current, checked_at: Time.current)
        operation[:installation].update!(checked_at: Time.current)
        @binding.github_app_installation = operation[:installation]
        @operation = capture_operation
      end
    end
    repo
  rescue BindingChanged
    raise
  rescue GithubAppClient::Error => error
    if (!require_verified || operation[:binding_state] == "verified") && !(require_verified && error.transient?)
      record_failure(error, operation: operation)
    else
      @operation = nil
    end
    raise
  end

  def operation_current?(operation)
    installation = operation[:installation]
    @binding.updated_at == operation[:binding_version] && @binding.github_app_installation_id == installation.id &&
      installation.connection_generation == operation[:installation_generation] && installation.connection_state == operation[:installation_state]
  end

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

  def record_failure(error, operation:)
    return unless self.class.enabled?(@binding.enrollment.cohort)

    installation = operation[:installation]
    installation.with_lock do
      @binding.with_lock do
        return false unless operation_current?(operation)

        if error.status == 401
          installation.fail_connection!(error.message, expected_generation: operation[:installation_generation], expected_state: operation[:installation_state])
          @binding.reload
        else
          @binding.fail_verification!(error.message)
        end
      end
    end
  end
end
