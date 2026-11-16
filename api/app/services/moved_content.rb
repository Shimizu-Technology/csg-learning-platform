# Old content ids after "Make a copy for this cohort" (CurriculumCopyForCohort).
#
# The copy gives a cohort new module, lesson, block and knowledge check ids.
# Installed apps, push notifications already delivered, sent messages and
# bookmarks still carry the shared curriculum's ids. For the copied cohort's
# learners those ids resolve to the copy's (ContentRedirect), so an old link
# opens the same lesson with the same progress, and a write against an old
# block lands on the copy.
#
# A redirect applies only when the viewer can't reach the record directly:
# - with a cohort in the request, when that cohort no longer uses the
#   record's curriculum (staff previews and learner links that name a cohort);
# - without one, for learners only, when none of their cohorts uses the
#   record's curriculum. A learner who is also in another cohort that still
#   shares it keeps opening the shared record there. "Their cohorts" are the
#   ones they are active in, or, with none, the ones they can still read
#   (candidate_cohorts); dropped and expired enrollments don't count.
# Staff without a cohort read every record directly, so nothing is redirected.
#
# Redirects chain (a copy of a copy), up to MAX_HOPS. When the viewer's
# cohorts disagree about where an old id went, nothing is redirected and the
# caller's normal access rule answers.
class MovedContent
  MODELS = {
    "CurriculumModule" => CurriculumModule,
    "Lesson" => Lesson,
    "ContentBlock" => ContentBlock,
    "KnowledgeCheck" => KnowledgeCheck
  }.freeze
  MAX_HOPS = 5

  # The id to use in place of `id` (an Integer), or `id` unchanged.
  def self.id_for(viewer, record_type, id, cohort_id: nil)
    new(viewer, record_type, cohort_id).id_for(id)
  end

  # The record for `id` after redirects, or nil when there is none.
  def self.find_by(viewer, record_type, id, cohort_id: nil, scope: nil)
    resolved = id_for(viewer, record_type, id, cohort_id: cohort_id)
    (scope || MODELS.fetch(record_type)).find_by(id: resolved)
  end

  # Like find_by, raising RecordNotFound (404) when nothing is there.
  def self.find(viewer, record_type, id, cohort_id: nil, scope: nil)
    resolved = id_for(viewer, record_type, id, cohort_id: cohort_id)
    (scope || MODELS.fetch(record_type)).find(resolved)
  end

  def initialize(viewer, record_type, cohort_id)
    raise ArgumentError, "unknown record type #{record_type}" unless MODELS.key?(record_type)

    @viewer = viewer
    @record_type = record_type
    @cohort_id = Integer(cohort_id.to_s, 10, exception: false) if cohort_id.present?
  end

  def id_for(id)
    original = Integer(id.to_s, 10, exception: false)
    return id unless original&.positive? && @viewer

    cohorts = candidate_cohorts
    return original unless cohorts

    current = original
    MAX_HOPS.times do
      # One query when nothing was copied (the common case): only an id with
      # a redirect for one of these cohorts costs more.
      targets = ContentRedirect.where(cohort_id: cohorts, record_type: @record_type, old_id: current).distinct.pluck(:new_id)
      return current if targets.empty?
      return current if reachable?(current, cohorts)
      return current unless targets.one?

      current = targets.first
    end
    current
  end

  private

  # The cohorts whose redirects apply, as ids or a subquery; nil for none.
  #
  # A learner's are the cohorts they can use: their active enrollments (the
  # ones they can save work in) or, when they have none, the ones they can
  # still read (paused, completed). Dropped and expired enrollments never
  # count, so a cohort the learner left that still uses the shared
  # curriculum doesn't keep an old id on the shared record, where their
  # saves would be refused. Still one query: this is a subquery.
  def candidate_cohorts
    return [ @cohort_id ] if @cohort_id
    return nil if @viewer.staff?

    readable = Enrollment.where(user_id: @viewer.id).with_read_access
    working = Enrollment.where(user_id: @viewer.id).active
    readable.where(id: working.select(:id)).or(readable.where(working.arel.exists.not)).select(:cohort_id)
  end

  # Does one of these cohorts use the curriculum this record is in?
  def reachable?(id, cohorts)
    curriculum_id = curriculum_id_for(id)
    curriculum_id && Cohort.where(id: cohorts, curriculum_id: curriculum_id).exists?
  end

  def curriculum_id_for(id)
    case @record_type
    when "CurriculumModule" then CurriculumModule.where(id: id).pick(:curriculum_id)
    when "Lesson" then Lesson.joins(:curriculum_module).where(id: id).pick("modules.curriculum_id")
    when "ContentBlock" then ContentBlock.joins(lesson: :curriculum_module).where(id: id).pick("modules.curriculum_id")
    when "KnowledgeCheck" then KnowledgeCheck.joins(content_block: { lesson: :curriculum_module }).where(id: id).pick("modules.curriculum_id")
    end
  end
end
