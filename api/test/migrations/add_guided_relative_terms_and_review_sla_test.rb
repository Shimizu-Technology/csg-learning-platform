require "test_helper"
require Rails.root.join("db/migrate/20261122020000_add_guided_relative_terms_and_review_sla").to_s

class AddGuidedRelativeTermsAndReviewSlaTest < ActiveSupport::TestCase
  test "additive and repeatable both ways with legacy rows left off" do
    migration = AddGuidedRelativeTermsAndReviewSla.new
    curriculum = Curriculum.create!(name: "Small class migration curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.new(2026, 10, 5))
    school = SchoolSetting.current
    migration.migrate(:down)
    migration.migrate(:down)
    reset_models

    assert_empty Cohort.column_names & AddGuidedRelativeTermsAndReviewSla::TERMS.map(&:to_s)
    assert_not_includes SchoolSetting.column_names, "review_sla_holidays"

    migration.migrate(:up)
    migration.migrate(:up)
    reset_models

    cohort.reload
    assert_equal [ nil, nil, nil ], cohort.attributes.values_at(*AddGuidedRelativeTermsAndReviewSla::TERMS.map(&:to_s))
    assert_equal [], school.reload.review_sla_holidays
    holiday = Date.new(2026, 11, 26)
    school.update!(review_sla_holidays: [ holiday ])
    assert_equal [ holiday ], school.reload.review_sla_holidays
    AddGuidedRelativeTermsAndReviewSla::TERMS.each do |column|
      error = assert_raises(ActiveRecord::StatementInvalid) do
        Cohort.transaction(requires_new: true) { cohort.update_column(column, 0) }
      end
      assert_includes error.message, "cohorts_#{column}_positive"
    end
  ensure
    reset_models
  end

  private

  def reset_models
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ Cohort, SchoolSetting ].each(&:reset_column_information)
  end
end
