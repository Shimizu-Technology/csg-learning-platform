require_relative 'boot'

# Ensure the seeded QA self-paced cohort starts with peer space OFF (the default)
# and that QA self_paced (user 6) has an active support window so once the admin
# opts the cohort in, posting works immediately.
self_paced = Cohort.find_by!(course_delivery: 'self_paced')
self_paced_user = User.find(6)
peer_user = User.find(7)
instructor = User.find(2)

SchoolSetting.current.update!(features: SchoolSetting.current.features.except('self_paced_peer_space'))
self_paced.update!(settings: (self_paced.settings || {}).deep_merge('features' => {}).tap { |s| s['features'].delete('self_paced_peer_space') })
self_paced.channels.find_or_create_by!(name: 'Staff Room') do |ch|
  ch.workspace = self_paced.workspace
  ch.visibility = :staff_only
  ch.status = :active
  ch.position = 1
end

[ self_paced_user, peer_user ].each do |u|
  enrollment = Enrollment.find_by!(user: u, cohort: self_paced)
  enrollment.update!(
    status: :active,
    first_opened_at: 2.days.ago,
    support_expires_at: 4.weeks.from_now,
    access_expires_at: 6.months.from_now
  )
end

channel = self_paced.channels.find_by!(name: 'Class Chat')
unless channel.messages.where(body: 'Welcome to the self-paced course community!').exists?
  Message.create!(channel: channel, author: instructor, body: 'Welcome to the self-paced course community!')
end

puts JSON.pretty_generate(
  self_paced_cohort_id: self_paced.id,
  workspace_id: self_paced.workspace.id,
  channel_id: channel.id,
  learner_id: self_paced_user.id,
  peer_id: peer_user.id,
  instructor_id: instructor.id
)
