require "test_helper"
require Rails.root.join("db/migrate/20260926193100_prepare_alumni_cohorts_for_launch")

class PrepareAlumniCohortsForLaunchTest < ActiveSupport::TestCase
  test "creates missing alumni workspace, Alumni Chat, and the curated resource set" do
    cohort = create_alumni_cohort
    cohort.workspace.destroy!

    PrepareAlumniCohortsForLaunch.new.migrate(:up)

    workspace = cohort.reload.workspace
    assert_equal [ "Alumni Chat" ], workspace.channels.pluck(:name)
    assert_equal PrepareAlumniCohortsForLaunch::ALUMNI_RESOURCES, cohort.settings.fetch("class_resources")
  end

  test "renames Class Chat and merges resources without duplicating existing links" do
    cohort = create_alumni_cohort
    workspace = cohort.workspace
    workspace.channels.first.update!(name: "Class Chat")
    existing_resource = PrepareAlumniCohortsForLaunch::ALUMNI_RESOURCES.first.deep_dup
    cohort.update!(settings: { "class_resources" => [ existing_resource ] })

    2.times { PrepareAlumniCohortsForLaunch.new.migrate(:up) }

    assert_equal [ "Alumni Chat" ], workspace.channels.reload.pluck(:name)
    resources = cohort.reload.settings.fetch("class_resources")
    assert_equal PrepareAlumniCohortsForLaunch::ALUMNI_RESOURCES.length, resources.length
    assert_equal resources.length, resources.pluck("url").uniq.length
  end

  test "preserves legacy messages when Alumni Chat already exists" do
    cohort = create_alumni_cohort
    workspace = cohort.workspace
    alumni_channel = workspace.channels.first
    alumni_channel.update!(name: "Alumni Chat")
    legacy_channel = workspace.channels.create!(
      cohort: cohort,
      name: "Class Chat",
      description: "Legacy conversation",
      visibility: :cohort,
      status: :active,
      position: 1
    )

    PrepareAlumniCohortsForLaunch.new.migrate(:up)

    assert Channel.exists?(legacy_channel.id)
    assert legacy_channel.reload.archived?
    assert_match "Class Chat (archived", legacy_channel.name
    assert_equal [ "Alumni Chat" ], workspace.channels.active.pluck(:name)
  end

  test "renames an archived Alumni Chat before creating the active channel" do
    cohort = create_alumni_cohort
    workspace = cohort.workspace
    workspace.channels.destroy_all
    archived_channel = workspace.channels.create!(
      cohort: cohort,
      name: "Alumni Chat",
      description: "Old alumni conversation",
      visibility: :cohort,
      status: :archived,
      position: 0
    )

    2.times { PrepareAlumniCohortsForLaunch.new.migrate(:up) }

    assert_equal [ "Alumni Chat" ], workspace.channels.reload.active.pluck(:name)
    assert_match "Alumni Chat (archived", archived_channel.reload.name
  end

  test "archives every extra active legacy channel" do
    cohort = create_alumni_cohort
    workspace = cohort.workspace
    general_channel = workspace.channels.create!(
      cohort: cohort,
      name: "General",
      description: "Another legacy conversation",
      visibility: :cohort,
      status: :active,
      position: 1
    )

    PrepareAlumniCohortsForLaunch.new.migrate(:up)

    assert_equal [ "Alumni Chat" ], workspace.channels.reload.active.pluck(:name)
    assert general_channel.reload.archived?
    assert_match "General (archived", general_channel.name
  end

  private

  def create_alumni_cohort
    curriculum = Curriculum.create!(name: "Alumni migration curriculum")
    Cohort.create!(
      curriculum: curriculum,
      name: "CSG Alumni",
      cohort_type: :alumni,
      start_date: Date.current,
      status: :active
    )
  end
end
