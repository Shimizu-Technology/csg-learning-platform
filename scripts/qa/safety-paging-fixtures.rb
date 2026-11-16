# Additive, synthetic-only fixtures for PR #278 fix round 1: an open queue past
# 100 reports, and a deletion request resolved after its admin alert was sent.
# Run after safety-fixtures.rb, against the harness's own database:
#   cd api && DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/safety-paging-fixtures.rb
require_relative 'boot'
require 'json'
abort 'Run safety-fixtures.rb first' unless ContentReport.exists?
abort 'Paging fixtures already installed' if ContentReport.count > 4

admin = User.find(1)
program = User.find(3)
behind = User.find(4)
channel = program.enrollments.first.cohort.channels.find_by!(name: 'qa-class')

# 101 more open reports, each on its own synthetic message, oldest first after the two from safety-fixtures.
101.times do |index|
  message = Message.create!(channel: channel, author: behind, body: "Synthetic paged message #{index + 1}.")
  ContentReport.create!(reporter: program, reported_user: behind, message: message, reason: :spam, details: "Synthetic paged report #{index + 1}.",
    created_at: Time.current + (index + 1).seconds)
end

# The pending deletion request already alerted admins; another admin completes it afterwards.
request = DataDeletionRequest.status_pending.first!
request.update!(status: :processing, resolved_by: admin)
request.update!(status: :completed, resolved_by: admin, resolved_at: Time.current, retention_note: 'Synthetic: completed after the alert.')

summary = { open_reports: ContentReport.where(status: %i[pending reviewing]).count, last_report: ContentReport.order(:created_at, :id).last.id, resolved_deletion: request.id }
File.write(File.expand_path('../../.qa-local/safety-paging.json', __dir__), JSON.generate(summary))
puts summary.to_json
