require "test_helper"
require_relative "../support/course_package_fixture"

class CoursePackageImporterTest < ActiveSupport::TestCase
  include CoursePackageFixture

  test "preview is read only and imported answers stay separate from body" do
    data = package
    assert_no_difference [ "Curriculum.count", "Lesson.count", "ContentBlock.count" ] do
      assert_equal 2, CoursePackageImporter.new(data).preview[:lessons]
    end
    result = CoursePackageImporter.new(data).call
    curriculum = Curriculum.find(result[:curriculum_id])
    assert curriculum.draft?
    assert_empty curriculum.cohorts
    assert_equal "Fictional practice", curriculum.description
    assert_equal "Learn first", curriculum.modules.first.description
    block = curriculum.modules.first.lessons.last.content_blocks.first
    assert_equal "Staff answer", block.solution
    refute_includes block.body, "Staff answer"
    assert block.submission_type_text_submission?
  end

  test "repeating a package preserves identities and attached video" do
    importer = CoursePackageImporter.new(package)
    first = importer.call
    curriculum = Curriculum.find(first[:curriculum_id])
    block = curriculum.modules.first.lessons.first.content_blocks.first
    block.update!(video_url: "https://example.com/practice.mp4")
    assert_no_difference [ "Curriculum.count", "Lesson.count", "ContentBlock.count" ] do
      assert_equal({ curriculum_id: curriculum.id, unchanged: true }, importer.call)
    end
    assert_equal "https://example.com/practice.mp4", block.reload.video_url
  end

  test "new revision updates an unassigned draft and keeps media" do
    first = CoursePackageImporter.new(package).call
    curriculum = Curriculum.find(first[:curriculum_id])
    video = curriculum.modules.first.lessons.first.content_blocks.first
    video.update!(video_url: "https://example.com/practice.mp4")
    revised = package
    revised["revision"] = "2026-10-05"
    revised["modules"][0]["lessons"][0]["blocks"][1]["body"] = "New explanation"
    assert_no_difference [ "Curriculum.count", "Lesson.count", "ContentBlock.count" ] do
      CoursePackageImporter.new(revised).call
    end
    assert_equal "New explanation", curriculum.modules.first.lessons.first.content_blocks.last.reload.body
    assert_equal "https://example.com/practice.mp4", video.reload.video_url
  end

  test "changed content requires revision and cannot overwrite assigned or active material" do
    first = CoursePackageImporter.new(package).call
    revised = package
    revised["description"] = "Changed"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(revised).call }
    revised["revision"] = "2026-10-05"
    curriculum = Curriculum.find(first[:curriculum_id])
    curriculum.update!(status: :active)
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(revised).call }
    curriculum.update!(status: :draft)
    Cohort.create!(curriculum: curriculum, name: "Upcoming empty pilot", start_date: Date.current, end_date: Date.current + 20)
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(revised).call }
    assert_equal "Fictional practice", curriculum.reload.description
  end

  test "revision preserves manual lesson edits by rejecting an overwrite" do
    first = CoursePackageImporter.new(package).call
    curriculum = Curriculum.find(first[:curriculum_id])
    block = curriculum.modules.first.lessons.first.content_blocks.last
    block.update!(body: "Staff correction")
    revised = package
    revised["revision"] = "2026-10-05"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(revised).call }
    assert_equal "Staff correction", block.reload.body
  end

  test "revision rejects manually added or deleted structure and submission settings" do
    mutations = [
      ->(curriculum) { curriculum.modules.first.lessons.create!(title: "Staff empty lesson", lesson_type: :reading, position: 4, release_day: 2) },
      ->(curriculum) { curriculum.modules.first.lessons.last.destroy! },
      ->(curriculum) { curriculum.modules.first.lessons.first.content_blocks.first.destroy! },
      ->(curriculum) { curriculum.modules.first.lessons.last.content_blocks.first.update!(submission_config: { "staff_setting" => true }) }
    ]
    mutations.each_with_index do |mutation, index|
      data = package
      data["key"] = "structure-#{index}"
      first = CoursePackageImporter.new(data).call
      curriculum = Curriculum.find(first[:curriculum_id])
      mutation.call(curriculum)
      data["revision"] = "2026-10-05"
      assert_no_difference [ "Lesson.count", "ContentBlock.count" ] do
        assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(data).call }
      end
    end
  end

  test "imports usable project criteria and preserves rubric identity across a revision" do
    data = package
    data["modules"][0]["lessons"][1]["blocks"][0]["rubric"] = { "title" => "Project", "criteria" => Array.new(12) { |index| { "title" => index.zero? ? "Explain" : "Criterion #{index}", "description" => "Explain a changed-data result" } } }
    first = CoursePackageImporter.new(data).call
    block = Curriculum.find(first[:curriculum_id]).modules.first.lessons.last.content_blocks.first
    rubric_id = block.rubric_id
    assert_equal "Explain", block.rubric.rubric_criteria.first.title
    data["revision"] = "2026-10-05"
    data["modules"][0]["lessons"][1]["blocks"][0]["rubric"]["criteria"][0]["description"] = "Explain two changed-data results"
    assert_no_difference "Rubric.count" do
      CoursePackageImporter.new(data).call
    end
    assert_equal rubric_id, block.reload.rubric_id
    assert_equal 12, block.rubric.rubric_criteria.count
    assert_equal "Explain two changed-data results", block.rubric.rubric_criteria.first.description
    block.rubric.rubric_criteria.first.update!(description: "Staff revision")
    data["revision"] = "2026-10-06"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(data).call }
  end

  test "invalid nested data creates nothing" do
    invalids = []
    bad = package; bad["modules"][0]["lessons"][0]["release_day"] = 21; invalids << bad
    bad = package; bad["modules"][0]["lessons"] << bad["modules"][0]["lessons"][0].deep_dup; invalids << bad
    bad = package; bad["modules"][0]["lessons"][0]["required"] = "false"; invalids << bad
    bad = package; bad["modules"][0]["lessons"][0]["blocks"][0]["s3_video_key"] = "foreign"; invalids << bad
    bad = package; bad["modules"][0]["lessons"][0]["blocks"] = [ "not an object" ]; invalids << bad
    assert_no_difference [ "Curriculum.count", "Lesson.count", "ContentBlock.count" ] do
      invalids.each { |data| assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(data).call } }
    end
  end

  test "package cannot remove lessons from an existing draft" do
    first = CoursePackageImporter.new(package).call
    revised = package
    revised["revision"] = "2026-10-05"
    revised["modules"][0]["lessons"].pop
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(revised).call }
    assert_equal 2, Curriculum.find(first[:curriculum_id]).modules.first.lessons.count
  end
end
