require "test_helper"

class RecordDestinationTest < ActiveSupport::TestCase
  test "shared descriptor contract and legacy path recovery" do
    cases = JSON.parse(File.read(Rails.root.join("../mobile/src/lib/fixtures/record-destination-contract.json")))
    cases.each do |entry|
      assert_equal entry.fetch("web"), RecordDestination.to_web_path(entry.fetch("descriptor"))
      assert_equal entry.fetch("native"), RecordDestination.to_native_href(entry.fetch("descriptor"))
      assert_equal entry.fetch("web"), RecordDestination.to_web_path(RecordDestination.from_path(entry.fetch("web")))
    end
  end

  test "bad context entries do not erase valid siblings" do
    descriptor = RecordDestination.from_path("/admin/submissions/31?cohort_id=4&student_id=bad&future=5")
    assert_equal({ "cohort_id" => "4" }, descriptor[:context])
    duplicated = RecordDestination.from_path("/lessons/42?cohort_id=1&cohort_id=2&future=x#block-8")
    assert_empty duplicated[:context]
    assert_equal({ "block_id" => "8" }, duplicated[:anchor])
  end
end
