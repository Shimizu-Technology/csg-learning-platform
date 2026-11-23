# Run only against an owned scripts/qa/run database.
require_relative "x6-actualize-demo-fixtures"

case ARGV.fetch(0)
when "reset"
  meta = X6ActualizeDemo.setup!
  program = meta.fetch(:personas).fetch(:program)
  GithubRepositoryBinding.find(program.fetch(:binding_id)).destroy!
  # Start before account setup. The "connect" fixture below restores proof
  # for the synthetic account used by the prework demo provider.
  User.find(program.fetch(:id)).update_columns(github_user_id: nil, github_verified_login: nil, github_verified_at: nil, github_username: nil)
  X6DemoFakeGithubClient.with_state(write: true) do |state|
    original = state.fetch("repositories").fetch(program.fetch(:repository_id).to_s)
    override_id = 89011
    state.fetch("repositories")[override_id.to_s] = original.merge("id" => override_id, "full_name" => "demo-program/module-exercises")
  end
when "connect"
  cfg = X6ActualizeDemo::PERSONA_CONFIGS.fetch("program")
  User.find(cfg.fetch(:user_id)).record_verified_github_identity!(id: cfg.fetch(:github_user_id), login: cfg.fetch(:github_login))
when "remove-access", "restore-access"
  cfg = X6ActualizeDemo::PERSONA_CONFIGS.fetch("program")
  cohort = Cohort.find_by!(name: X6ActualizeDemo::COHORT_NAME)
  cohort.github_app_installations.find_by!(installation_id: cfg.fetch(:installation_id))
    .update!(connection_state: ARGV.first == "remove-access" ? "failed" : "connected")
when "legacy"
  cohort = Cohort.find_by!(name: X6ActualizeDemo::COHORT_NAME)
  cohort.update!(settings: cohort.settings.deep_merge("features" => { "student_experience_v2" => false }))
when "disable-sync"
  cohort = Cohort.find_by!(name: X6ActualizeDemo::COHORT_NAME)
  cohort.update!(settings: cohort.settings.deep_merge("features" => { "github_sync" => false }))
else
  abort "Unknown student GitHub fixture action"
end
