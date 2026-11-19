require_relative 'boot'
cohort = Cohort.find_by!(name: 'QA Program')
mod = cohort.curriculum.modules.first
lesson = mod.lessons.create!(title: 'Synthetic video versions', release_day: 0, position: 99)
block = lesson.content_blocks.create!(block_type: :video, position: 0, title: 'Video styles', s3_video_key: 'content_videos/11111111-1111-4111-8111-111111111111/studio.mp4', s3_video_duration_seconds: 60)
File.write(File.expand_path('../../.qa-local/video-versions.json', __dir__), JSON.generate({ lesson: lesson.id, block: block.id, cohort: cohort.id }))
