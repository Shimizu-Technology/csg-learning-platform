require_relative "boot"

curriculum = Curriculum.create!(name: "QA exercise check rules", status: :active)
mod = curriculum.modules.create!(name: "Ruby basics", position: 0)
lesson = mod.lessons.create!(title: "Practice with variables", position: 0, release_day: 0)
lesson.content_blocks.create!(block_type: :text, body: "Start with a local variable.", position: 0)
exercise = lesson.content_blocks.create!(title: "Exercise 111", position: 1, block_type: :exercise, filename: "111.rb",
  submission_type: :prework_github_sync, body: "Print the value of a variable.")
cohort = Cohort.create!(name: "QA verified offering", curriculum: curriculum, course_delivery: "self_paced", status: :active,
  start_date: LearningCalendar.today, public_title: "QA Ruby course", public_description: "The basics of Ruby.",
  public_image_url: "https://example.invalid/course.png", stripe_price_id: "price_qa_ux2_499", public_price_cents: 39_900,
  content_defaults: { mod.id.to_s => { "assigned" => true } })
teacher = User.find(2)
cohort.instructors << teacher
cohort.update!(support_instructor: teacher)

puts JSON.generate({ lessonId: lesson.id, blockId: exercise.id, cohortId: cohort.id })
