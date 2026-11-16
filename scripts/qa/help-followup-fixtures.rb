# Additive, synthetic-only W7 PR 7.4 fixtures (help request and follow-up pages).
# Run after scripts/qa/run start, against the harness's own database:
#   cd api && DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/help-followup-fixtures.rb
# Gives the seeded help-request plan its server-built evidence, and starts a
# redo plan for the program student whose evidence names their submissions.
require_relative 'boot'
abort 'Help and follow-up fixtures already installed' if Intervention.exists?(trigger_type: :redo)

admin = User.find(1)
instructor = User.find(2)
program = User.find(3)
behind = User.find(4)
[ admin, instructor, program, behind ].each { |user| user.update!(community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION) }

from_help = Intervention.find_by!(trigger_type: :help_request)
from_help.update!(evidence_snapshot: InterventionEvidenceBuilder.new(enrollment: from_help.enrollment, trigger_type: :help_request, help_request: from_help.help_request).call)

enrollment = program.enrollments.first
redo_plan = Intervention.create!(enrollment: enrollment, owner: instructor, created_by: instructor, trigger_type: :redo, severity: :normal,
  evidence_snapshot: InterventionEvidenceBuilder.new(enrollment: enrollment, trigger_type: :redo).call,
  action_summary: 'Review the synthetic redo together.', next_follow_up_at: 2.days.from_now)
RecoveryPlan.create!(enrollment: enrollment, intervention: redo_plan, owner: instructor, created_by: instructor, source: :manual,
  target_pace: 'Two synthetic lessons a week', required_scope: 'Finish the required synthetic labs.', next_check_in_at: 7.days.from_now)

# A second open request, so Reply & resolve can move on in Support.
lesson = enrollment.cohort.curriculum.modules.first.lessons.second || enrollment.cohort.curriculum.modules.first.lessons.first
HelpRequest.create!(student: program, cohort: enrollment.cohort, category: :technical, context_type: :lesson, context_id: lesson.id,
  context_label: lesson.title, context_path: "/lessons/#{lesson.id}?cohort_id=#{enrollment.cohort_id}", message: 'My synthetic loop never stops.')

puts({ help_plan: from_help.id, help_request: from_help.help_request_id, redo_plan: redo_plan.id, redo_submissions: redo_plan.evidence_snapshot['submission_ids'] }.to_json)
