# Additive, synthetic-only W6 PR 6.4b fixtures (Safety, team member pages, help-request alert).
# Run after scripts/qa/run start, against the harness's own database:
#   cd api && DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/safety-fixtures.rb
require_relative 'boot'
abort 'Safety fixtures already installed' if ContentReport.exists?

admin = User.find(1)
instructor = User.find(2)
program = User.find(3)
behind = User.find(4)
cohort = program.enrollments.first.cohort
[ admin, instructor, program, behind ].each { |user| user.update!(community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION) }

# Open: a class chat message (admins can open it) and a direct message the admin isn't in.
channel = cohort.channels.find_by!(name: 'qa-class')
posted = Message.create!(channel: channel, author: behind, body: 'Synthetic message someone reported.')
open_channel = ContentReport.create!(reporter: program, reported_user: behind, message: posted, reason: :harassment, details: 'Synthetic report details.')
dm = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ program, behind ])
private_message = Message.create!(direct_conversation: dm, author: behind, body: 'Synthetic private message.')
ContentReport.create!(reporter: program, reported_user: behind, message: private_message, reason: :spam)

# Resolved: actioned and dismissed, by the admin, with earlier times.
resolved_post = Message.create!(channel: channel, author: program, body: 'Synthetic resolved message.')
ContentReport.create!(reporter: behind, reported_user: program, message: resolved_post, reason: :inappropriate_content,
  status: :actioned, reviewed_by: admin, resolved_at: 2.hours.ago)
ContentReport.create!(reporter: behind, reported_user: instructor, reason: :other, details: 'Synthetic account report.',
  status: :dismissed, reviewed_by: admin, resolved_at: 1.day.ago)

# Blocks between a learner and a learner, and a learner and staff.
UserBlock.create!(blocker: program, blocked_user: behind)
UserBlock.create!(blocker: behind, blocked_user: instructor)

# An open deletion request and a completed one.
DataDeletionRequest.create!(user: User.find(7))
done = DataDeletionRequest.create!(user: User.find(8))
done.update!(status: :processing, resolved_by: admin)
done.update!(status: :completed, resolved_by: admin, resolved_at: Time.current, retention_note: 'Synthetic: account and files removed.')

# Admin alerts (no push in the harness) and the staff help-request alert.
NotificationDeliveryService.admin_alert(open_channel, push: false)
NotificationDeliveryService.admin_alert(DataDeletionRequest.status_pending.first!, push: false)
help = HelpRequest.where(student: behind).first!
NotificationDeliveryService.help_request_created(help, push: false)

# Editing access for the instructor on the program cohort, read-only on their team page.
cohort.cohort_instructor_assignments.find_by!(user: instructor).set_lesson_editing!(true, by: admin)

puts({ content_reports: ContentReport.count, user_blocks: UserBlock.count, deletion_requests: DataDeletionRequest.count, help_request: help.id, cohort: cohort.id }.to_json)
