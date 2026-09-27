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
end
