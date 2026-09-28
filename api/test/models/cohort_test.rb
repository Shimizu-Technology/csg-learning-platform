require "test_helper"

class CohortTest < ActiveSupport::TestCase
  test "alumni cohorts use the shared alumni organization unless another is specified" do
    curriculum = Curriculum.create!(name: "Alumni GitHub defaults")

    alumni = Cohort.create!(curriculum: curriculum, name: "CSG Alumni", cohort_type: :alumni, start_date: Date.current)
    custom = Cohort.create!(curriculum: curriculum, name: "Another alumni group", cohort_type: :alumni, start_date: Date.current, github_organization_name: "Another-Org")
    bootcamp = Cohort.create!(curriculum: curriculum, name: "Bootcamp", cohort_type: :bootcamp, start_date: Date.current)

    assert_equal "Code-School-of-Guam-Alumni", alumni.github_organization_name
    assert_equal "Another-Org", custom.github_organization_name
    assert_nil bootcamp.github_organization_name
  end

  test "GitHub organization accepts a name and rejects a URL" do
    cohort = Cohort.new(name: "CSG Alumni", cohort_type: :alumni, start_date: Date.current, github_organization_name: "https://github.com/Code-School-of-Guam-Alumni")

    refute cohort.valid?
    assert_includes cohort.errors.attribute_names, :github_organization_name
  end

  test "blank or padded organization names are normalized before saving" do
    curriculum = Curriculum.create!(name: "GitHub name normalization")
    cohort = Cohort.create!(curriculum: curriculum, name: "Bootcamp", start_date: Date.current, github_organization_name: "  Another-Org  ")
    assert_equal "Another-Org", cohort.github_organization_name

    cohort.update!(github_organization_name: "\t ")
    assert_nil cohort.reload.github_organization_name
  end
end
