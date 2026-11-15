require_relative "../support/model_coverage"

class SchoolSettingTest < ModelCoverageTestCase
  test "singleton loads persistently and database rejects a second id" do
    SchoolSetting.delete_all
    row = SchoolSetting.current
    assert_equal 1, row.id
    assert_equal row, SchoolSetting.current
    assert_invalid row, :public_catalog_mode, "invalid"
    assert_database_rejects row, { id: 2 }
    assert_equal 1, SchoolSetting.count
  end

  test "request cache is scoped and reset between requests" do
    SchoolSetting::RequestCache.enabled = true
    first = SchoolSetting.current
    assert_same first, SchoolSetting.current
    SchoolSetting::RequestCache.reset
    assert_not_same first, SchoolSetting.current
  ensure
    SchoolSetting::RequestCache.reset
  end
end
