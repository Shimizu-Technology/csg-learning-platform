require "test_helper"

class RecordDestinationTest < ActiveSupport::TestCase
  test "shared descriptor contract and legacy path recovery" do
    cases = JSON.parse(File.read(Rails.root.join("../mobile/src/lib/fixtures/record-destination-contract.json")))
    cases.each do |entry|
      assert_nil RecordDestination.from_path(entry["rejected_web"]) if entry["rejected_web"]
      if entry["input_web"]
        assert_equal entry.fetch("descriptor"), RecordDestination.from_path(entry["input_web"]).as_json
      end
      assert_equal entry.fetch("web"), RecordDestination.to_web_path(entry.fetch("descriptor"))
      # Web-only kinds (staff, Safety items) have no native screen.
      native = RecordDestination.to_native_href(entry.fetch("descriptor"))
      entry.fetch("native").nil? ? assert_nil(native) : assert_equal(entry.fetch("native"), native)
      assert_equal entry.fetch("web"), RecordDestination.to_web_path(RecordDestination.from_path(entry.fetch("web")))
    end
  end

  test "native and canonical aliases share the parser table" do
    assert_equal "/staff/student/18?cohort_id=4", RecordDestination.to_native_href(RecordDestination.from_path("/staff/student/18?cohort_id=4"))
    assert_equal "/staff/student/18?cohort_id=4", RecordDestination.to_native_href(RecordDestination.from_path("/admin/cohorts/4/students/18"))
    assert_equal "/staff/curriculum/3?cohort_id=4", RecordDestination.to_native_href(RecordDestination.from_path("/staff/curriculum/3?cohort_id=4"))
  end

  test "search destinations open role-appropriate web and native surfaces" do
    curriculum = RecordDestination.build(kind: "curriculum", id: 3, context: { staff: true, cohort_id: 4 })
    assert_equal "/admin/content?cohort_id=4#curriculum-3", RecordDestination.to_web_path(curriculum)
    assert_equal "/staff/curriculum/3?cohort_id=4", RecordDestination.to_native_href(curriculum)
    resource = RecordDestination.build(kind: "resource", id: 2, context: { cohort_id: 4, query: "Synthetic & resource" })
    assert_equal "/resources?cohort_id=4&resource=2&q=Synthetic+%26+resource", RecordDestination.to_web_path(resource)
    assert_equal RecordDestination.to_web_path(resource), RecordDestination.to_native_href(resource)
    assert_nil RecordDestination.to_native_href(RecordDestination.build(kind: "staff", id: 1))

    learner_file = RecordDestination.build(kind: "cohort_file", id: 42, context: { cohort_id: 4 })
    assert_equal "/resources?cohort_id=4&file=42", RecordDestination.to_web_path(learner_file)
    assert_equal "/resources?cohort_id=4&file=42", RecordDestination.to_native_href(learner_file)
    assert_equal "/resources?cohort_id=4&file=42", RecordDestination.to_web_path(RecordDestination.from_path("/resources?cohort_id=4&file=42"))

    staff_student_file = RecordDestination.build(kind: "cohort_file", id: 42, context: { cohort_id: 4, student_id: 18, staff: true })
    assert_equal "/admin/cohorts/4?tab=files&student=18&file=42", RecordDestination.to_web_path(staff_student_file)
    assert_equal "/staff/files?cohort_id=4&student=18&file=42", RecordDestination.to_native_href(staff_student_file)
    assert_equal "/admin/cohorts/4?tab=files&student=18&file=42", RecordDestination.to_web_path(RecordDestination.from_path("/admin/cohorts/4?tab=files&student=18&file=42"))
  end

  test "multiple fragment delimiters are rejected" do
    assert_nil RecordDestination.from_path("/lessons/42#block-8#x")
  end

  test "bad context entries do not erase valid siblings" do
    descriptor = RecordDestination.from_path("/admin/submissions/31?cohort_id=4&student_id=bad&future=5")
    assert_equal({ "cohort_id" => "4" }, descriptor[:context])
    duplicated = RecordDestination.from_path("/lessons/42?cohort_id=1&cohort_id=2&future=x#block-8")
    assert_empty duplicated[:context]
    assert_equal({ "block_id" => "8" }, duplicated[:anchor])
  end
end
