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

  test "module_type defaults to workshop and accepts valid overrides" do
    default_import = CoursePackageImporter.new(package).call
    assert Curriculum.find(default_import[:curriculum_id]).modules.first.workshop?

    custom = package
    custom["key"] = "recording-course"
    custom["modules"][0]["module_type"] = "recording"
    custom_import = CoursePackageImporter.new(custom).call
    assert Curriculum.find(custom_import[:curriculum_id]).modules.first.recording?

    invalid = package
    invalid["key"] = "bad-module-type"
    invalid["modules"][0]["module_type"] = "unknown_type"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(invalid).call }

    nil_type = package
    nil_type["key"] = "nil-module-type"
    nil_type["modules"][0]["module_type"] = nil
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(nil_type).call }
  end

  test "omitted module_type and explicit workshop produce identical digests while transitions respect revisions and manual edits" do
    # 1. Omitted -> explicit "workshop" (at end and in converter key order) at same revision is a no-op
    first = CoursePackageImporter.new(package).call
    curriculum = Curriculum.find(first[:curriculum_id])

    explicit_end = package
    explicit_end["modules"][0]["module_type"] = "workshop"
    assert_equal true, CoursePackageImporter.new(explicit_end).preview[:unchanged]
    assert_equal({ curriculum_id: curriculum.id, unchanged: true }, CoursePackageImporter.new(explicit_end).call)

    explicit_mid = package
    mod = explicit_mid["modules"][0]
    explicit_mid["modules"][0] = {
      "key" => mod["key"],
      "title" => mod["title"],
      "description" => mod["description"],
      "module_type" => "workshop",
      "total_days" => mod["total_days"],
      "schedule_days" => mod["schedule_days"],
      "lessons" => mod["lessons"]
    }
    assert_equal true, CoursePackageImporter.new(explicit_mid).preview[:unchanged]
    assert_equal({ curriculum_id: curriculum.id, unchanged: true }, CoursePackageImporter.new(explicit_mid).call)

    # 2. Explicit "workshop" -> omitted at same revision is a no-op
    ws_pkg = package
    ws_pkg["key"] = "explicit-workshop-first"
    ws_pkg["modules"][0]["module_type"] = "workshop"
    ws_first = CoursePackageImporter.new(ws_pkg).call
    ws_omitted = package
    ws_omitted["key"] = "explicit-workshop-first"
    assert_equal true, CoursePackageImporter.new(ws_omitted).preview[:unchanged]
    assert_equal({ curriculum_id: ws_first[:curriculum_id], unchanged: true }, CoursePackageImporter.new(ws_omitted).call)

    # 3. "recording" -> identical retry is a no-op; same revision omitted fails; newer revision omitted updates to workshop
    rec_pkg = package
    rec_pkg["key"] = "recording-to-default"
    rec_pkg["modules"][0]["module_type"] = "recording"
    rec_first = CoursePackageImporter.new(rec_pkg).call
    rec_curriculum = Curriculum.find(rec_first[:curriculum_id])
    assert rec_curriculum.modules.first.recording?

    assert_equal({ curriculum_id: rec_curriculum.id, unchanged: true }, CoursePackageImporter.new(rec_pkg).call)

    same_rev_omitted = package
    same_rev_omitted["key"] = "recording-to-default"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(same_rev_omitted).call }

    newer_omitted = package
    newer_omitted["key"] = "recording-to-default"
    newer_omitted["revision"] = "2026-10-05"
    updated = CoursePackageImporter.new(newer_omitted).call
    assert_equal({ curriculum_id: rec_curriculum.id, unchanged: false }, updated)
    assert rec_curriculum.modules.first.reload.workshop?

    # 4. Manual edit conflict preservation when revising module_type
    rec_curriculum.modules.first.update!(module_type: :prework)
    conflict_rev = package
    conflict_rev["key"] = "recording-to-default"
    conflict_rev["revision"] = "2026-10-06"
    conflict_rev["modules"][0]["module_type"] = "recording"
    assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(conflict_rev).call }
    assert rec_curriculum.modules.first.reload.prework?
  end

  test "rejects app-managed S3 keys, s3 URIs, and HTTP(S) URLs in video and recording block bodies" do
    managed_values = [
      "content_videos/550e8400-e29b-41d4-a716-446655440000/lesson.mp4",
      "content_videos/block_12/20261004120000_clip.mp4",
      "recordings/cohort_4/20261004120000_deadbeef_session.mp4",
      "message_attachments/dm_9/550e8400-e29b-41d4-a716-446655440000/file.png",
      "course_resource_uploads/curriculum_2/token/archive.zip",
      "s3://csg-bucket/content_videos/clip.mp4",
      "https://vimeo.com/123456",
      "http://cdn.example.com/lesson.mp4",
      "Watch at https://example.com/watch?v=1"
    ]

    %w[video recording].each do |block_type|
      managed_values.each do |value|
        bad = package
        bad["modules"][0]["lessons"][0]["blocks"][0]["block_type"] = block_type
        bad["modules"][0]["lessons"][0]["blocks"][0]["body"] = value
        assert_raises(CoursePackageImporter::InvalidPackage) { CoursePackageImporter.new(bad).call }
      end

      # Empty placeholders remain valid
      placeholder = package
      placeholder["key"] = "#{block_type}-placeholder"
      placeholder["modules"][0]["lessons"][0]["blocks"][0]["block_type"] = block_type
      placeholder["modules"][0]["lessons"][0]["blocks"][0]["body"] = ""
      assert_equal 2, CoursePackageImporter.new(placeholder).preview[:lessons]
    end

    # Teaching text, exercise, and checkpoint blocks referencing paths or HTTP(S) URLs remain allowed
    text_pkg = package
    text_pkg["key"] = "text-block-paths-and-urls"
    text_pkg["modules"][0]["lessons"][0]["blocks"][1]["body"] = "API endpoint: GET /recordings/123 and docs at https://docs.python.org/3/"
    text_pkg["modules"][0]["lessons"][1]["blocks"][0]["body"] = "Submit your repo at https://github.com/example/starter"
    assert_equal 2, CoursePackageImporter.new(text_pkg).preview[:lessons]
  end
end
