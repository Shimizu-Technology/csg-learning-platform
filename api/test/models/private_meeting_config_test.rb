require_relative "../support/model_coverage"

class PrivateMeetingConfigTest < ModelCoverageTestCase
  test "week boundaries use saved school timezone including midnight and course end" do
    assert_equal 1, meeting_config.week_for(Time.utc(2026, 4, 5, 14))
    assert_nil meeting_config.week_for(Time.utc(2026, 4, 5, 13, 59))
    assert_equal 2, meeting_config.week_for(Time.utc(2026, 4, 12, 14))
    assert_nil meeting_config.week_for(Time.utc(2026, 4, 26, 14))
    course.update!(end_date: Date.new(2026, 4, 7))
    assert_nil meeting_config.week_for(Time.utc(2026, 4, 7, 14))
    assert_invalid meeting_config, :instructor, student
    %i[duration_minutes weeks].each { |field| assert_database_rejects meeting_config, { field => 0 } }
    %i[reschedule_cutoff_hours max_student_changes].each { |field| assert_database_rejects meeting_config, { field => -1 } }
  end

  test "config is unique per cohort and cannot be removed with slots" do
    assert_not meeting_config.dup.valid?
    other_course = Cohort.create!(curriculum: curriculum, name: "Other", start_date: course.start_date)
    other = PrivateMeetingConfig.create!(cohort: other_course, instructor: staff)
    assert_database_rejects other, { cohort_id: course.id }, ActiveRecord::RecordNotUnique
    slot
    assert_not meeting_config.destroy
    assert PrivateMeetingConfig.exists?(meeting_config.id)
  end
end
