# Staff a learner can message right now, by the rules POST
# /api/v1/direct_conversations applies: people the cohort's workspace offers
# this learner (its current instructors and admins; a self-paced course's
# support instructor), not archived, and with no block either way. Learner
# pages offer "Message", "Ask about this feedback" and "Ask for a plan" only to
# these people, so the action never ends in a refusal.
#
# Queries: a fixed few (workspace access, the allowed people, blocks), however
# many candidates.
class StaffContact
  def self.eligible_ids(enrollment, candidate_ids)
    candidates = candidate_ids.compact.uniq
    return [] if candidates.empty?

    learner = enrollment.user
    workspace = enrollment.cohort.workspace
    return [] unless workspace&.visible_to?(learner)

    allowed = workspace.available_users_for(learner).where(id: candidates).where(role: %i[instructor admin]).reorder(nil).pluck(:id)
    allowed - UserBlock.related_user_ids(learner.id, allowed)
  end
end
