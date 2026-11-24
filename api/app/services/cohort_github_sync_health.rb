class CohortGithubSyncHealth
  def initialize(cohort)
    @cohort = cohort
  end

  def call
    school = FeatureSwitches.school(read_only: true)
    resolved = FeatureSwitches.for(cohort: @cohort, school: school)
    installations = @cohort.github_app_installations.order(:id).to_a
    connected_installations = installations.select { |row| row.connection_state == "connected" }
    module_names = @cohort.curriculum.modules.order(:position).index_by(&:id)
    module_github = (@cohort.settings || {})["module_github_config"] || {}
    github_modules = module_names.values.filter_map do |mod|
      cfg = module_github[mod.id.to_s] || {}
      next unless cfg["requires_github"] == true

      {
        id: mod.id,
        name: mod.name,
        repository_name: cfg["repository_name"].presence || @cohort.repository_name
      }
    end

    enrollments = @cohort.enrollments.active
      .joins(:user).merge(User.not_archived)
      .includes(:user, github_repository_bindings: :github_reconciliation_state)
      .order("users.last_name ASC, users.first_name ASC, enrollments.id ASC")
      .to_a

    app_configured = GithubAppCredentials.configured?
    cohort_app_enabled = resolved["github_app"] == true
    github_sync_enabled = resolved["github_sync"] == true
    webhooks_enabled = resolved["github_webhooks"] == true
    reconciliation_enabled = resolved["github_reconciliation"] == true
    auto_sync_enabled = webhooks_enabled || reconciliation_enabled
    app_ready = app_configured && cohort_app_enabled && github_sync_enabled && connected_installations.any?

    learners = enrollments.map do |enrollment|
      build_learner(
        enrollment,
        module_names: module_names,
        github_modules: github_modules,
        app_ready: app_ready,
        cohort_app_enabled: cohort_app_enabled,
        github_sync_enabled: github_sync_enabled,
        auto_sync_enabled: auto_sync_enabled,
        app_configured: app_configured,
        has_connected_installation: connected_installations.any?
      )
    end

    {
      cohort_id: @cohort.id,
      app_configured: app_configured,
      oauth_configured: GithubAppCredentials.oauth_configured?,
      school_github_app_enabled: school["github_app"] == true,
      cohort_github_app_enabled: cohort_app_enabled,
      github_sync_enabled: github_sync_enabled,
      webhooks_enabled: webhooks_enabled,
      reconciliation_enabled: reconciliation_enabled,
      grade_suggestions_enabled: resolved["github_grade_suggestions"] == true,
      installations: installations.map { |row| GithubAppSerializer.installation(row) },
      github_modules: github_modules,
      summary: {
        total_learners: learners.size,
        healthy_count: learners.count { |row| row[:status] == "healthy" },
        sync_error_count: learners.count { |row| row[:status] == "sync_error" },
        unverified_count: learners.count { |row| row[:status] == "unverified" },
        not_bound_count: learners.count { |row| row[:status] == "not_bound" },
        identity_missing_count: learners.count { |row| row[:status] == "identity_missing" },
        app_not_ready_count: learners.count { |row| row[:status] == "app_not_ready" }
      },
      learners: learners
    }
  end

  private

  def build_learner(enrollment, module_names:, github_modules:, app_ready:, cohort_app_enabled:, github_sync_enabled:, auto_sync_enabled:, app_configured:, has_connected_installation:)
    user = enrollment.user
    bindings = enrollment.github_repository_bindings.sort_by(&:id).map do |binding|
      binding.enrollment = enrollment
      serialized = GithubAppSerializer.binding(binding, include_reconciliation: true)
      serialized.merge(
        "module_name" => binding.curriculum_module_id ? module_names[binding.curriculum_module_id]&.name : nil
      )
    end

    status, reason, last_synced_at, next_retry_at, last_error = evaluate_learner(
      user: user,
      bindings: bindings,
      github_modules: github_modules,
      app_ready: app_ready,
      cohort_app_enabled: cohort_app_enabled,
      github_sync_enabled: github_sync_enabled,
      auto_sync_enabled: auto_sync_enabled,
      app_configured: app_configured,
      has_connected_installation: has_connected_installation
    )

    {
      enrollment_id: enrollment.id,
      user_id: user.id,
      full_name: user.full_name,
      email: user.email,
      github_username: user.github_username,
      identity_verified: user.github_identity_verified?,
      github_verified_login: user.github_verified_login,
      github_verified_at: user.github_verified_at,
      status: status,
      plain_reason: reason,
      last_synced_at: last_synced_at,
      next_retry_at: next_retry_at,
      last_error: last_error,
      bindings: bindings
    }
  end

  def evaluate_learner(user:, bindings:, github_modules:, app_ready:, cohort_app_enabled:, github_sync_enabled:, auto_sync_enabled:, app_configured:, has_connected_installation:)
    unless app_ready
      reason = if !app_configured
        "GitHub App credentials are not configured for this school deployment yet."
      elsif !github_sync_enabled
        "GitHub sync is turned off for this cohort."
      elsif !cohort_app_enabled
        "GitHub App access is turned off for this cohort."
      elsif !has_connected_installation
        "Connect a GitHub App installation for this cohort before learners can sync."
      end
      return [ "app_not_ready", reason, nil, nil, nil ]
    end

    unless user.github_identity_verified?
      return [ "identity_missing", "The learner hasn't connected their GitHub account in Profile yet.", nil, nil, nil ]
    end

    if bindings.empty?
      return [ "not_bound", "GitHub account is connected, but no repository is linked yet.", nil, nil, nil ]
    end

    default_binding = bindings.find { |row| row["curriculum_module_id"].nil? }
    applicable_bindings = bindings
    if github_modules.any?
      missing_modules = []
      resolved_bindings = []
      github_modules.each do |mod|
        matched = bindings.find { |row| row["curriculum_module_id"] == mod[:id] } || default_binding
        if matched
          resolved_bindings << matched
        else
          missing_modules << mod[:name]
        end
      end
      if missing_modules.any?
        return [
          "not_bound",
          "No repository is linked for #{missing_modules.join(', ')}.",
          nil,
          nil,
          nil
        ]
      end
      applicable_bindings = resolved_bindings.uniq { |row| row["id"] }
    end

    unverified = applicable_bindings.find { |row| row["verification_state"] != "verified" }
    if unverified
      reason = humanize_error(unverified["failure_reason"]) || "Repository #{unverified["full_name"]} still needs verification before syncing can run."
      return [ "unverified", reason, nil, nil, unverified["failure_reason"] ]
    end

    errored = applicable_bindings.find { |row| row["last_error"].present? || row["last_status"] == "failed" }
    last_synced_at = applicable_bindings.filter_map { |row| row["last_reconciled_at"] }.max
    next_retry_at = applicable_bindings.filter_map { |row| row["next_reconcile_at"] }.min

    if errored
      raw_error = errored["last_error"].presence || "Automatic sync failed."
      return [ "sync_error", humanize_error(raw_error), last_synced_at, next_retry_at, raw_error ]
    end

    reason = if !auto_sync_enabled
      "Repository verified for manual sync. Turn on GitHub webhooks or hourly reconciliation for automatic syncing."
    elsif last_synced_at
      "Repository verified and syncing automatically."
    else
      "Repository verified and ready for automatic sync."
    end
    [ "healthy", reason, last_synced_at, next_retry_at, nil ]
  end

  def humanize_error(message)
    text = message.to_s.strip
    return nil if text.blank?

    case text
    when /rate.?limit/i
      "GitHub temporarily rate-limited syncing. The next retry will run automatically."
    when /404|not found/i
      "The linked GitHub repository could not be found. Ask the learner to confirm the repository name and permissions."
    when /401|403|forbidden|unauthorized|suspended|installation/i
      "The GitHub App lost permission to read this repository. Reconnect the installation or ask the learner to re-grant repository access."
    when /fork/i
      "Forked repositories are not accepted. Ask the learner to use an original repository on their own account."
    when /identity/i
      "The learner's GitHub identity needs to be reconnected and verified again."
    else
      text
    end
  end
end
