require "test_helper"

class WorkspaceTest < ActiveSupport::TestCase
  test "alumni cohorts receive an Alumni Chat workspace channel" do
    curriculum = Curriculum.create!(name: "Alumni Workspace Curriculum")
    cohort = Cohort.create!(
      curriculum: curriculum,
      name: "CSG Alumni",
      cohort_type: :alumni,
      start_date: Date.current,
      status: :active
    )

    workspace = cohort.reload.workspace

    assert_equal "CSG Alumni", workspace.name
    assert_equal [ "Alumni Chat" ], workspace.channels.pluck(:name)
    assert_equal "Ongoing discussion and support for Code School of Guam alumni.", workspace.channels.first.description
  end

  test "regular cohorts continue to receive Class Chat" do
    curriculum = Curriculum.create!(name: "Bootcamp Workspace Curriculum")
    cohort = Cohort.create!(
      curriculum: curriculum,
      name: "Cohort 9",
      cohort_type: :bootcamp,
      start_date: Date.current,
      status: :active
    )

    assert_equal [ "Class Chat" ], cohort.reload.workspace.channels.pluck(:name)
  end
  test "channel management follows admin community authority and assigned cohort teaching" do
    curriculum = Curriculum.create!(name: "Authority curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Authority cohort", start_date: Date.current, status: :active)
    teacher = User.create!(clerk_id: "workspace_teacher", email: "workspace-teacher@example.com", role: :instructor)
    admin = User.create!(clerk_id: "workspace_admin", email: "workspace-admin@example.com", role: :admin)
    community = Workspace.create!(name: "Staff-wide community", slug: "staff-wide-authority", workspace_type: :community)
    refute cohort.workspace.channels_manageable_by?(teacher)
    cohort.cohort_instructor_assignments.create!(user: teacher)
    assert cohort.workspace.channels_manageable_by?(teacher)
    assert cohort.workspace.channels_manageable_by?(admin)
    assert community.visible_to?(teacher), "Existing staff-wide community visibility is retained"
    assert_includes Workspace.visible_for(teacher), community
    community.workspace_memberships.create!(user: teacher, role: :manager)
    refute community.channels_manageable_by?(teacher), "Membership manager does not grant global admin authority"
    assert community.channels_manageable_by?(admin)
    community.update!(status: :archived)
    refute community.channels_manageable_by?(admin)
    refute community.visible_to?(teacher)
  end
end
