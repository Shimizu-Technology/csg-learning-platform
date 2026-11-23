require_relative "boot"

cohort = Cohort.find_by!(name: "QA Program")
mod = cohort.curriculum.modules.first
original = "content_videos/11111111-1111-4111-8111-111111111111/studio.mp4"
alternate = "content_videos/22222222-2222-4222-8222-222222222222/desktop.mp4"
sections = [
  { label: "First Core", start_seconds: 1, end_seconds: 3, required: true },
  { label: "Second Core", start_seconds: 5, end_seconds: 7, required: true },
  { label: "Optional practice", start_seconds: 10, end_seconds: 12, required: false }
]
fixtures = [ sections, [] ].map.with_index do |ranges, index|
  lesson = mod.lessons.create!(title: ["Synthetic Core sections", "Synthetic whole recording"][index], release_day: 0, position: 99 + index)
  metadata = { video_segments: ranges }
  if ranges.any?
    metadata[:video_versions] = [
      { id: "studio", label: "Studio", s3_video_key: original },
      { id: "desktop", label: "Real desktop", s3_video_key: alternate }
    ]
  end
  block = lesson.content_blocks.create!(block_type: :recording, position: 0, title: lesson.title,
    s3_video_key: original, s3_video_duration_seconds: 20, metadata: metadata)
  { lesson: lesson.id, block: block.id }
end

File.write(File.expand_path("../../.qa-local/recording-sections.json", __dir__),
  JSON.generate({ cohort: cohort.id, core: fixtures[0], whole: fixtures[1] }))
