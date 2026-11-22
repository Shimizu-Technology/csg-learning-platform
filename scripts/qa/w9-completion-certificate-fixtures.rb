require_relative "boot"

# Each browser/theme case gets fresh records, since the learner submits work
# and staff grade, revoke and reissue it through the app.
nonce = SecureRandom.hex(5)
reviewer = User.find(2)
results = {}
ActiveRecord::Base.transaction do
  school = SchoolSetting.current
  school.update!(features: school.features.merge("certificates" => true))
  { "on" => true, "off" => false }.each do |label, enabled|
    learner = User.create!(clerk_id: "certificate_#{label}_#{nonce}", email: "certificate-#{label}-#{nonce}@example.invalid",
      first_name: "Sam", last_name: "Example", role: :student,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    ClerkIdentity.create!(user: learner, issuer: "https://test.clerk.invalid", clerk_user_id: learner.clerk_id)
    curriculum = Curriculum.create!(name: "QA Python certificate #{label} #{nonce}", status: :active)
    mod = curriculum.modules.create!(name: "Course project", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = mod.lessons.create!(title: "Build a weather dashboard", lesson_type: :project, position: 0, release_day: 0, required: true)
    block = lesson.content_blocks.create!(block_type: :exercise, title: "Submit your project", position: 0, body: "Describe what your dashboard shows.",
      filename: "answer.md", submission_type: :text_submission, metadata: { "language" => "markdown", "final_project" => true })
    cohort = Cohort.create!(name: "Private QA cohort #{label} #{nonce}", public_title: "Python Foundations", curriculum: curriculum, status: :active,
      start_date: Date.current - 21, course_delivery: enabled ? "guided" : "program",
      settings: { "features" => enabled ? { "certificates" => true } : {}, "next_step" => {
        "title" => "Build your next project", "description" => "Apply what you learned in the next course.", "offering_slug" => "python-projects"
      } })
    cohort.instructors << reviewer
    enrollment = Enrollment.create!(user: learner, cohort: cohort, status: :active, access_expires_at: 2.months.from_now,
      start_here_dismissed_at: Time.current)
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    results[label] = { student: learner.id, cohort: cohort.id, enrollment: enrollment.id, lesson: lesson.id, block: block.id }
  end
end
puts results.to_json
