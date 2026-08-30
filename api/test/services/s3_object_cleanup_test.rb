require "test_helper"

class S3ObjectCleanupTest < ActiveSupport::TestCase
  setup do
    @curriculum = Curriculum.create!(name: "S3 cleanup curriculum")
    @curriculum_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Week one",
      position: 0,
      schedule_days: "daily"
    )
    @lesson = Lesson.create!(
      curriculum_module: @curriculum_module,
      title: "Cleanup lesson",
      position: 0,
      release_day: 0
    )
  end

  test "deletes an object after its recording is destroyed" do
    cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cleanup cohort",
      start_date: Date.current,
      cohort_type: :bootcamp,
      status: :active
    )
    key = "recordings/cohort_#{cohort.id}/cleanup.mp4"
    recording = cohort.recordings.create!(
      title: "Cleanup recording",
      s3_key: key,
      content_type: "video/mp4",
      file_size: 1.megabyte,
      position: 0
    )
    deleted_keys = []

    with_s3_cleanup_stubs(deleted_keys) { recording.destroy! }

    assert_equal [ key ], deleted_keys
  end

  test "cascade deletion removes a lesson video object" do
    key = "content_videos/block_cleanup/lesson.mp4"
    @lesson.content_blocks.create!(
      block_type: :video,
      position: 0,
      s3_video_key: key,
      s3_video_content_type: "video/mp4",
      s3_video_size: 1.megabyte
    )
    deleted_keys = []

    with_s3_cleanup_stubs(deleted_keys) { @lesson.destroy! }

    assert_equal [ key ], deleted_keys
  end

  test "does not delete an object that is still referenced" do
    key = "content_videos/shared/video.mp4"
    first = @lesson.content_blocks.create!(block_type: :video, position: 0, s3_video_key: key)
    @lesson.content_blocks.create!(block_type: :video, position: 1, s3_video_key: key)
    deleted_keys = []

    with_s3_cleanup_stubs(deleted_keys) { first.destroy! }

    assert_empty deleted_keys
  end

  test "storage failure does not roll back the database deletion" do
    key = "content_videos/failing/video.mp4"
    block = @lesson.content_blocks.create!(block_type: :video, position: 0, s3_video_key: key)

    with_s3_delete(->(_key) { raise IOError, "storage unavailable" }) { assert block.destroy! }

    refute ContentBlock.exists?(block.id)
  end

  private

  def with_s3_cleanup_stubs(deleted_keys, &block)
    with_s3_delete(->(key) { deleted_keys << key; true }, &block)
  end

  def with_s3_delete(delete_method)
    original_configured = S3Service.method(:configured?)
    original_delete = S3Service.method(:delete_object)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:delete_object, delete_method)
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:delete_object, original_delete)
  end
end
