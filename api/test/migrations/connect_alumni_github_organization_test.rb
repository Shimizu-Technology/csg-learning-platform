require "test_helper"
require Rails.root.join("db/migrate/20260928050000_connect_alumni_github_organization")

class ConnectAlumniGithubOrganizationTest < ActiveSupport::TestCase
  test "backfills only alumni cohorts without an organization" do
    curriculum = Curriculum.create!(name: "Alumni GitHub backfill")
    missing = Cohort.create!(curriculum: curriculum, name: "Alumni missing", cohort_type: :alumni, start_date: Date.current)
    blank = Cohort.create!(curriculum: curriculum, name: "Alumni blank", cohort_type: :alumni, start_date: Date.current)
    tab_only = Cohort.create!(curriculum: curriculum, name: "Alumni tabs", cohort_type: :alumni, start_date: Date.current)
    custom = Cohort.create!(curriculum: curriculum, name: "Alumni custom", cohort_type: :alumni, start_date: Date.current, github_organization_name: "Another-Org")
    bootcamp = Cohort.create!(curriculum: curriculum, name: "Bootcamp", cohort_type: :bootcamp, start_date: Date.current)
    missing.update_columns(github_organization_name: nil)
    blank.update_columns(github_organization_name: " ")
    tab_only.update_columns(github_organization_name: "\t\t")

    2.times { ConnectAlumniGithubOrganization.new.migrate(:up) }

    assert_equal "Code-School-of-Guam-Alumni", missing.reload.github_organization_name
    assert_equal "Code-School-of-Guam-Alumni", blank.reload.github_organization_name
    assert_equal "Code-School-of-Guam-Alumni", tab_only.reload.github_organization_name
    assert_equal "Another-Org", custom.reload.github_organization_name
    assert_nil bootcamp.reload.github_organization_name
  end
end
