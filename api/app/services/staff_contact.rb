# Staff a learner can message right now: the cohort workspace's messageable
# people (Workspace#messageable_users_for, the same list GET
# /direct_conversations/available_users gives the directory and #294's message
# actions), limited to staff. That's its current instructors and admins, or a
# self-paced course's support instructor, not archived, with no block either
# way. Learner pages offer "Message", "Ask about this feedback" and "Ask for a
# plan" only to these people, so the action never ends in a refusal.
#
# Queries: a fixed few (workspace access, blocks, the allowed people), however
# many candidates.
class StaffContact
  def self.eligible_ids(enrollment, candidate_ids)
    candidates = candidate_ids.compact.uniq
    return [] if candidates.empty?

    learner = enrollment.user
    workspace = enrollment.cohort.workspace
    return [] unless workspace&.visible_to?(learner)

    workspace.messageable_users_for(learner).where(id: candidates).where(role: %i[instructor admin]).reorder(nil).pluck(:id)
  end
end
