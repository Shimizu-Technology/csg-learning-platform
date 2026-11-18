require_relative "boot"
ids = JSON.parse(Rails.root.join("..", ".qa-local/w9-pace.json").read)
enrollment = Enrollment.find(ids.fetch("rehearsal").fetch("enrollment"))
cohort = enrollment.cohort
lesson = cohort.curriculum.modules.order(:position).first.lessons.order(:release_day, :position).first
cohort.cohort_module_submission_windows.find_or_create_by!(module_id: lesson.module_id, week_number: 1).update!(submissions_close_at: 1.day.ago)
LearnerExtension.where(enrollment_id: [ enrollment.id, ids.fetch("late").fetch("enrollment") ]).destroy_all
Submission.where(enrollment_id: enrollment.id).destroy_all
ids["lesson"] = lesson.id
block = lesson.content_blocks.find_by!(block_type: :exercise)
block.update!(filename: "answer.md", metadata: { "language" => "markdown" }, submission_type: "text_submission")
ids["block"] = block.id
Rails.root.join("..", ".qa-local/w9-deadlines.json").write(JSON.pretty_generate(ids))
