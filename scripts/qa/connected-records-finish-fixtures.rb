# Additive, synthetic-only fixtures for the last L-5.2 record pages (a return plan, a community report and
# a course offering's purchases) and the rest of L-3.2's where-used links (person → reports and blocks,
# lesson → activity, course package → curriculum and cohorts). Run once after scripts/qa/run start, from api/:
#   DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/connected-records-finish-fixtures.rb
# - QA Program (taught by the QA instructor, 2): the behind student (4) gets a return plan from their seeded
#   follow-up plan, with 3 check-ins; persona 3 reports a class-chat message and a direct message from persona 4
#   and blocks them; lesson activity on the first QA Week 1 lesson.
# - "QA Finish Other Program" shares QA Program Lab and is taught only by "QA Finish Other instructor", with its
#   own return plan, a report about its learner and activity on the same lesson. The QA instructor must never
#   open these or see the cohort's name.
# - QA Self paced is put on sale with 30 synthetic purchases (27 paid and enrolled, 3 checkouts started).
# - A synthetic course package is imported and assigned to "QA Package Cohort"; its JSON is written to
#   .qa-local/finish-package.json so the browser can preview it again.
# Writes the ids to .qa-local/connected-records-finish.json for connected-records-finish.spec.ts.
require_relative 'boot'
require_relative '../../api/test/support/course_package_fixture'
abort 'Connected-records fixtures already installed' if Cohort.exists?(name: 'QA Finish Other Program')

admin = User.find(1)
instructor = User.find(2)
program_student = User.find(3)
behind = User.find(4)
program = Cohort.find_by!(name: 'QA Program')
self_paced = Cohort.find_by!(name: 'QA Self paced')
curriculum = program.curriculum

def person(slug, last_name, role)
  user = User.create!(clerk_id: "qa_#{slug}", email: "#{slug}@example.invalid", first_name: 'QA', last_name: last_name, role: role,
                      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  ClerkIdentity.create!(user: user, issuer: 'https://test.clerk.invalid', clerk_user_id: user.clerk_id)
  user
end

def return_plan(enrollment, owner, intervention: nil)
  RecoveryPlan.create!(enrollment: enrollment, intervention: intervention, source: :manual, status: :active, owner: owner, created_by: owner,
                       target_pace: 'Two synthetic labs a day', required_scope: "QA Week 1 labs\nQA Week 2 practice", optional_scope: 'Reflections',
                       check_in_cadence: 'Every Monday', next_check_in_at: 1.day.ago)
end

ActiveRecord::Base.transaction do
  # Return plan: from the behind student's seeded follow-up plan, three check-ins.
  behind_enrollment = program.enrollments.find_by!(user: behind)
  intervention = Intervention.find_by!(enrollment: behind_enrollment)
  plan = return_plan(behind_enrollment, instructor, intervention: intervention)
  3.times { |i| plan.check_ins.create!(author: instructor, body: "Synthetic check-in #{i + 1}: finished lab #{i + 1}.", next_check_in_at: (i + 2).days.from_now) }

  # Reports and a block: persona 3 reports persona 4's class-chat message and a direct message, then blocks them.
  channel = program.channels.find_by!(name: 'qa-class')
  channel_message = Message.create!(channel: channel, author: behind, body: 'Synthetic reported class-chat message.')
  channel_report = ContentReport.create!(reporter: program_student, reported_user: behind, message: channel_message, reason: :harassment, details: 'Synthetic: unkind reply in class chat.')
  dm = DirectConversation.find_or_create_for!(workspace: program.workspace, users: [ program_student, behind ])
  dm_message = Message.create!(direct_conversation: dm, author: behind, body: 'Synthetic reported direct message.')
  dm_report = ContentReport.create!(reporter: program_student, reported_user: behind, message: dm_message, reason: :spam)
  UserBlock.create!(blocker: program_student, blocked_user: behind)

  # Lesson activity: persona 3 on the first QA Week 1 lesson's checkpoint and exercise.
  lesson = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curriculum.id, position: 0 }).order(:release_day, :position, :id).first
  checkpoint = lesson.content_blocks.find_by!(block_type: :checkpoint)
  exercise = lesson.content_blocks.find_by!(block_type: :exercise, submission_type: :text_submission)
  enrollment = program.enrollments.find_by!(user: program_student)
  work = Submission.find_by(user: program_student, content_block: exercise) ||
         Submission.create!(user: program_student, enrollment: enrollment, content_block: exercise, submission_type: :text_submission, text: 'Synthetic counter explanation')
  ActivityEvent.record!(event_type: 'checkpoint_completed', actor: program_student, cohort: program, record: checkpoint)
  ActivityEvent.record!(event_type: 'submission_created', actor: program_student, cohort: program, record: work)

  # The other cohort: same curriculum, another instructor, one of each.
  other_instructor = person('finish_other_instructor', 'Finish Other instructor', :instructor)
  other = Cohort.create!(name: 'QA Finish Other Program', curriculum: curriculum, start_date: Date.current - 14, status: :active)
  other.cohort_instructor_assignments.create!(user: other_instructor)
  other_learner = person('finish_other_learner', 'Finish Other learner', :student)
  other_enrollment = Enrollment.create!(user: other_learner, cohort: other, status: :active)
  other_enrollment.assign_cohort_content_defaults!
  other_plan = return_plan(other_enrollment, other_instructor)
  other_report = ContentReport.create!(reporter: other_instructor, reported_user: other_learner, reason: :other, details: 'Synthetic other-cohort report.')
  ActivityEvent.record!(event_type: 'checkpoint_completed', actor: other_learner, cohort: other, record: checkpoint)

  # The offering: QA Self paced on sale, 27 paid and enrolled, 3 checkouts started.
  self_paced.update!(public_title: 'QA Self-paced Lab', public_slug: 'qa-self-paced-lab', public_price_cents: 4_900, stripe_price_id: 'price_qa_synthetic')
  purchase_ids = 30.times.map do |i|
    buyer = person("finish_buyer_#{i}", format('Buyer %02d', i), :student)
    paid = i < 27
    Enrollment.create!(user: buyer, cohort: self_paced, status: :active).assign_cohort_content_defaults! if paid
    CoursePurchase.create!(user: buyer, cohort: self_paced, stripe_price_id: 'price_qa_synthetic', price_cents: 4_900, status: paid ? 'paid' : 'pending').id
  end

  # A course package already imported and used by one cohort.
  package = Object.new.extend(CoursePackageFixture).package
  imported = Curriculum.find(CoursePackageImporter.new(package).call[:curriculum_id])
  imported.update!(status: :active)
  package_cohort = Cohort.create!(name: 'QA Package Cohort', curriculum: imported, start_date: Date.current, status: :active)
  package_cohort.cohort_instructor_assignments.create!(user: instructor)

  require 'json'
  local = File.expand_path('../../.qa-local', __dir__)
  File.write("#{local}/finish-package.json", JSON.generate(package))
  ids = {
    program_cohort_id: program.id, other_cohort_id: other.id, self_paced_cohort_id: self_paced.id, package_cohort_id: package_cohort.id,
    recovery_plan_id: plan.id, intervention_id: intervention.id, behind_id: behind.id, program_student_id: program_student.id,
    channel_id: channel.id, channel_message_id: channel_message.id, channel_report_id: channel_report.id, dm_report_id: dm_report.id,
    lesson_id: lesson.id, imported_curriculum_id: imported.id, admin_id: admin.id, instructor_id: instructor.id,
    newest_purchase_id: purchase_ids.last,
    other: { recovery_plan_id: other_plan.id, content_report_id: other_report.id, learner_id: other_learner.id }
  }
  File.write("#{local}/connected-records-finish.json", JSON.pretty_generate(ids))
  puts ids.to_json
end
