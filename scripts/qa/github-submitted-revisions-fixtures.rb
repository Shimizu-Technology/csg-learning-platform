require_relative 'boot'
require_relative '../../api/test/support/fake_github_app_client'

root = Rails.root.join('../.qa-local')
state_path = root.join('state.json')
abort 'Revision fixtures require the current owned QA database' unless state_path.file?
state = JSON.parse(File.read(state_path))
unless state['created'] == true && state['database'] == ActiveRecord::Base.connection_db_config.database
  abort 'Revision fixtures refuse a database outside the current owned harness'
end
command = ARGV.first || 'setup'
source = case command
when 'setup', 'initial', 'reset' then { text: "puts 'first submitted source'", sha: 'a' * 40 }
when 'changed' then { text: "puts 'corrected submitted source'", sha: 'b' * 40 }
when 'identical' then { text: "puts 'corrected submitted source'", sha: 'c' * 40 }
else abort 'Use setup, reset, initial, changed or identical'
end
File.write(root.join('github-submitted-source.json'), JSON.generate(source))
if command == 'reset'
  ids = JSON.parse(File.read(root.join('github-submitted-revisions.json'))).values
  ids.each do |row|
    Submission.where(content_block_id: row.fetch('block_id'), enrollment_id: row.fetch('enrollment_id')).destroy_all
    Progress.where(content_block_id: row.fetch('block_id'), enrollment_id: row.fetch('enrollment_id')).delete_all
  end
end
exit unless command == 'setup'

SchoolSetting.current.update!(features: SchoolSetting.current.features.merge('github_app' => true))
cohort = Cohort.find(1)
cohort.update!(settings: cohort.settings.deep_merge('features' => { 'github_app' => true }), repository_name: 'prework-exercises')
student = User.find(3)
student.record_verified_github_identity!(id: '24680', login: 'app-learner')
installation = cohort.github_app_installations.find_or_initialize_by(installation_id: 77001)
installation.update!(app_id: 12345, account_id: 24680,
  account_login: 'app-learner', account_type: 'User', repository_selection: 'selected', connected_at: Time.current, checked_at: Time.current)
ids = {}
[[cohort, student, 'on'], [Cohort.find(2), User.find(6), 'off']].each do |course, learner, key|
  if key == 'off'
    course.update!(settings: course.settings.deep_merge('features' => { 'github_app' => false }), repository_name: 'prework-exercises')
    learner.update!(github_username: 'off-learner')
  end
  mod = course.curriculum.modules.find_or_create_by!(name: "QA Submitted revisions #{key}") { |row| row.assign_attributes(position: 10, module_type: :prework) }
  lesson = mod.lessons.find_or_create_by!(title: "QA Revision exercise #{key}") { |row| row.assign_attributes(position: 0, release_day: 0) }
  block = lesson.content_blocks.find_or_create_by!(title: 'Capture submitted source') do |row|
    row.assign_attributes(block_type: :exercise, position: 0,
      submission_type: :prework_github_sync, filename: '111.rb', body: 'Use the simulated provider to submit a fictional Ruby file.')
  end
  enrollment = learner.enrollments.find_by!(cohort: course)
  if key == 'on'
    binding = enrollment.github_repository_bindings.find_or_initialize_by(curriculum_module: mod)
    binding.update!(github_app_installation: installation, full_name: 'app-learner/prework-exercises')
    GithubRepositoryAccess.new(binding, client: FakeGithubAppClient.new).verify!
  end
  ids[key] = { cohort_id: course.id, module_id: mod.id, block_id: block.id, user_id: learner.id, enrollment_id: enrollment.id }
end
File.write(root.join('github-submitted-revisions.json'), JSON.pretty_generate(ids))
puts JSON.pretty_generate(ids)
