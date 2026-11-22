require "test_helper"

class VideoVersionsTest < ActiveSupport::TestCase
  setup do
    curriculum = Curriculum.create!(name: "Version fixtures")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Module", position: 0)
    lesson = mod.lessons.create!(title: "Versions", position: 0, release_day: 0)
    @key = "content_videos/11111111-1111-4111-8111-111111111111/original.mp4"
    @other = "content_videos/22222222-2222-4222-8222-222222222222/other.mp4"
    @block = lesson.content_blocks.create!(block_type: :video, position: 0, s3_video_key: @key, s3_video_duration_seconds: 300)
    @versions = [ { "id" => "studio", "label" => "Studio", "s3_video_key" => @key },
      { "id" => "desktop", "label" => "Real desktop", "s3_video_key" => @other } ]
  end

  test "legacy videos need no versions and versions can be reordered without replacing media" do
    assert_empty @block.video_versions
    @block.update!(metadata: { video_versions: @versions })
    assert_equal @versions, @block.reload.video_versions
    @block.metadata = { video_versions: @versions.reverse }
    refute @block.playable_media_replaced?
    @block.save!
    assert_equal "desktop", @block.reload.video_versions.first["id"]
  end

  test "rejects malformed, duplicate and unmanaged versions" do
    [ "bad", [ {} ], @versions * 5, @versions.map { |v| v.merge("id" => "same") },
      [ @versions.first.merge("label" => " ") ], [ @versions.first.merge("s3_video_key" => "private/secret") ] ].each do |value|
      @block.metadata = { video_versions: value }
      refute @block.valid?, value.inspect
    end
  end

  test "alternate uploads are storage references until removed" do
    @block.update!(metadata: { video_versions: @versions })
    assert S3ObjectCleanup.send(:referenced?, @other)
    @block.update!(metadata: { video_versions: [] })
    refute S3ObjectCleanup.send(:referenced?, @other)
    assert S3ObjectCleanup.send(:referenced?, @key)
  end

  test "versions require an author-established duration before any learner report" do
    @block.s3_video_duration_seconds = nil
    @block.metadata = { video_versions: @versions }
    refute @block.valid?
    @block.metadata["video_versions_duration_seconds"] = 300
    @block.save!
    assert_equal 300, @block.reload.s3_video_duration_seconds
  end

  test "replacing the original clears its old version duration hint" do
    @block.update!(metadata: { video_versions: [], video_versions_duration_seconds: 300 })
    @block.update!(s3_video_key: @other, s3_video_duration_seconds: nil)
    assert_nil @block.reload.metadata["video_versions_duration_seconds"]
  end

  test "legacy clients cannot replace underlying media with versions still attached" do
    @block.update!(metadata: { video_versions: @versions })
    @block.s3_video_key = @other
    refute @block.valid?
    assert_includes @block.errors[:metadata], "remove video versions before replacing the underlying video"
  end
end
