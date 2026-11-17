require "test_helper"
require Rails.root.join("db/migrate/20261118020000_keep_running_cohorts_on_current_student_experience").to_s

class KeepRunningCohortsOnCurrentStudentExperienceTest < ActiveSupport::TestCase
  test "running cohorts with active learners keep the current experience; new and explicit choices are untouched" do
    curriculum = Curriculum.create!(name: "Experience curriculum")
    running = cohort("Cohort 3", curriculum, Date.current - 60, settings: { "features" => { "recordings" => false } })
    explicit = cohort("Already chosen", curriculum, Date.current - 30, settings: { "features" => { "student_experience_v2" => true } })
    upcoming = cohort("Cohort 4", curriculum, Date.current + 20)
    paused_only = cohort("Paused only", curriculum, Date.current - 10)
    malformed = cohort("Malformed settings", curriculum, Date.current - 5, settings: { "features" => [] })
    [ running, explicit, upcoming, malformed ].each_with_index { |item, index| enroll(item, "active_#{index}", :active) }
    enroll(paused_only, "paused", :paused)
    migration = KeepRunningCohortsOnCurrentStudentExperience.new.tap { |item| item.verbose = false }
    migration.migrate(:down)
    FeatureSwitchChange.reset_column_information
    migration.migrate(:up)
    FeatureSwitchChange.reset_column_information

    assert_equal({ "recordings" => false, "student_experience_v2" => false }, running.reload.settings["features"], "other overrides stay")
    assert_equal false, FeatureSwitches.for(cohort: running)["student_experience_v2"]
    assert_equal true, FeatureSwitches.for(cohort: explicit.reload)["student_experience_v2"], "an explicit choice is never replaced"
    assert_equal true, FeatureSwitches.for(cohort: upcoming.reload)["student_experience_v2"], "a cohort that hasn't started gets the new experience"
    assert_equal true, FeatureSwitches.for(cohort: paused_only.reload)["student_experience_v2"]
    assert_equal({ "student_experience_v2" => false }, malformed.reload.settings["features"])
    audits = FeatureSwitchChange.where(cohort_id: [ running.id, malformed.id ]).order(:cohort_id)
    assert_equal [ running.id, malformed.id ].sort, audits.map(&:cohort_id)
    assert audits.all? { |audit| audit.actor_id.nil? && audit.after.dig("overrides", "student_experience_v2") == false }
    assert_equal "Cohort 3", audits.find { |audit| audit.cohort_id == running.id }.after.dig("cohort", "name")

    # A second run changes nothing; down removes only what up wrote.
    assert_no_difference -> { FeatureSwitchChange.count } do
      migration.migrate(:up)
    end
    migration.migrate(:down)
    FeatureSwitchChange.reset_column_information
    assert_equal({ "recordings" => false }, running.reload.settings["features"])
    assert_equal({ "student_experience_v2" => true }, explicit.reload.settings["features"])
    assert_empty FeatureSwitchChange.where(actor_id: nil)
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    FeatureSwitchChange.reset_column_information
  end

  private

  def cohort(name, curriculum, start_date, settings: {})
    Cohort.create!(name: name, curriculum: curriculum, start_date: start_date, status: start_date > Date.current ? :upcoming : :active).tap do |record|
      record.update_columns(settings: settings)
    end
  end

  def enroll(cohort, name, status)
    user = User.create!(clerk_id: "experience_#{name}", email: "experience-#{name}@example.com", role: :student)
    Enrollment.create!(user: user, cohort: cohort, status: status)
  end
end
