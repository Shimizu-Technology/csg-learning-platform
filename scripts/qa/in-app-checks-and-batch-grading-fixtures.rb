require_relative 'boot'

# Synthetic fixtures for in-app-checks-and-batch-grading.spec.ts. Per browser run (1280 and 390,
# light and dark), a Pass / Redo cohort taught by the QA instructor (2) with one lesson:
# - "Add two numbers" (Ruby, in-app code, browser runner on, no checks yet): the admin (1) adds
#   starter code and checks in the lesson editor, a new student submits it, the instructor grades it;
# - "Cart total" (JavaScript, browser runner with three checks): three other students' work waits,
#   two passing and one failing, for Batch review.
# Run after scripts/qa/run start, from api/ (each load makes a fresh set, so it can be re-run):
#   DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/in-app-checks-and-batch-grading-fixtures.rb

instructor = User.find(2)
runs = %w[chromium-1280-light chromium-1280-dark chromium-390-light chromium-390-dark]

JS_CHECKS = [
  { 'id' => 'sum', 'name' => 'Adds the prices', 'code' => 'assertEqual(10, total([1, 2, 3, 4]))' },
  { 'id' => 'empty', 'name' => 'An empty cart is 0', 'code' => 'assertEqual(0, total([]))' },
  { 'id' => 'prints', 'name' => 'Prints the total', 'code' => "assertIncludes(output, 'Total: 10')" }
].freeze
JS_WORK = {
  'Pass' => "function total(items) {\n  return items.reduce((sum, price) => sum + price, 0)\n}\nconsole.log('Total: ' + total([1, 2, 3, 4]))",
  'Outlier' => "const total = (items) => {\n  let sum = 0\n  for (const price of items) sum += price\n  return sum\n}\nconsole.log(`Total: ${total([1, 2, 3, 4])}`)",
  'Fail' => "function total(items) {\n  return items.length\n}\nconsole.log('Total: ' + total([1, 2, 3, 4]))"
}.freeze

LOAD = SecureRandom.hex(3)
curriculum = Curriculum.create!(name: "Code Checks QA Curriculum #{LOAD}", grading_scale: 'pass_redo')
mod = curriculum.modules.create!(name: 'Checks week', position: 0, day_offset: 0, schedule_days: 'weekdays')

def learner(name, run, cohort, mod)
  slug = "#{run}-#{name}-#{LOAD}".downcase.gsub(/[^a-z0-9]+/, '-')
  user = User.create!(clerk_id: "qa_checks_#{slug}", email: "qa-checks-#{slug}@example.invalid", first_name: name, last_name: 'Checks', role: :student,
    community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
  enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
  [ user, enrollment ]
end

fixtures = runs.each_with_index.to_h do |run, index|
  lesson = mod.lessons.create!(title: "Checks practice #{index + 1}", position: index, release_day: 0, requires_submission: true, published: true)
  ruby_block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: 'Add two numbers', filename: 'add.rb',
    body: 'Write `add(a, b)` so it returns the sum, then print `add(2, 3)`.', submission_type: :text_submission,
    submission_config: { 'runner' => { 'enabled' => true, 'language' => 'ruby' } })
  js_block = lesson.content_blocks.create!(block_type: :exercise, position: 1, title: 'Cart total', filename: 'cart.js',
    body: 'Write `total(items)` and print the total of `[1, 2, 3, 4]`.', submission_type: :text_submission,
    submission_config: { 'runner' => { 'enabled' => true, 'language' => 'javascript', 'checks' => JS_CHECKS } })
  cohort = Cohort.create!(name: "Checks QA #{run} #{LOAD}", curriculum: curriculum, start_date: Date.current - 7.days, status: :active)
  cohort.cohort_instructor_assignments.create!(user: instructor)
  student, = learner('Sam', run, cohort, mod)
  batch = JS_WORK.each_with_index.to_h do |(label, code), offset|
    user, enrollment = learner(label, run, cohort, mod)
    submission = Submission.create!(user: user, enrollment: enrollment, content_block: js_block, submission_type: :text_submission,
      text: code, num_submissions: 1, created_at: (3 - offset).hours.ago)
    [ label.downcase, { submission_id: submission.id, user_name: user.full_name } ]
  end
  [ run, { cohort_id: cohort.id, lesson_id: lesson.id, ruby_block_id: ruby_block.id, js_block_id: js_block.id, student_id: student.id, batch: batch } ]
end

path = File.expand_path('../../.qa-local/in-app-checks-and-batch-grading.json', __dir__)
File.write(path, JSON.pretty_generate(fixtures))
puts fixtures.to_json
