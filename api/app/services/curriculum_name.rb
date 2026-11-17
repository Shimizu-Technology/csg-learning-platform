# A curriculum's name as one viewer may see it (L-3.2 privacy rule).
#
# A cohort's own copy ("Make a copy for this cohort", #276) is stored as
# "<source name> (copy)". The cohort it belongs to is on its CurriculumCopy
# row, and the name shows it only to people who can see that cohort:
#
# - viewers who can open the copy's cohort (admins, its instructors, its
#   learners) see "Shared lab (Cohort Birch)";
# - everyone else sees "Shared lab (copy)".
#
# Copies made before this rule stored "<source name> (<cohort name>)". Those
# names get the same treatment, so a stored cohort name never reaches someone
# who can't see that cohort. A copy an admin renamed keeps its name, with the
# cohort's name taken out for viewers who can't see it.
#
# Batch callers call `preload` with every curriculum id first: then each name
# costs no query. Otherwise each new id costs one.
class CurriculumName
  COPY_SUFFIX = " (copy)".freeze

  def self.stored_for_copy(source_name)
    "#{source_name}#{COPY_SUFFIX}"
  end

  def initialize(viewer)
    @viewer = viewer
    @copies = {}
  end

  def preload(curriculum_ids)
    ids = Array(curriculum_ids).compact.uniq - @copies.keys
    return self if ids.empty?

    found = CurriculumCopy.includes(:cohort).where(copy_curriculum_id: ids).index_by(&:copy_curriculum_id)
    ids.each { |id| @copies[id] = found[id] }
    self
  end

  # Within one cohort's own pages (its home, settings, roster, plan), a copy
  # made for that cohort may name it: anyone shown those pages can see the
  # cohort. Pass the cohort as `in_cohort:` there; no viewer is needed.
  def self.in_cohort(cohort)
    new(nil).for(cohort.curriculum, in_cohort: cohort)
  end

  # The name for `curriculum` (a Curriculum, or anything with id and name).
  def for(curriculum, in_cohort: nil)
    return nil unless curriculum

    name = curriculum.name.to_s
    # A list that preloaded `cohort_copy: :cohort` costs nothing more here.
    if !@copies.key?(curriculum.id) && curriculum.is_a?(Curriculum) && curriculum.association(:cohort_copy).loaded?
      @copies[curriculum.id] = curriculum.cohort_copy
    end
    preload([ curriculum.id ]) unless @copies.key?(curriculum.id)
    copy = @copies[curriculum.id]
    return name unless copy&.cohort

    cohort_name = copy.cohort.name
    base = if name.end_with?(COPY_SUFFIX)
      name.delete_suffix(COPY_SUFFIX)
    elsif name.end_with?(" (#{cohort_name})")
      name.delete_suffix(" (#{cohort_name})")
    end

    if in_cohort&.id == copy.cohort_id || visible?(copy.cohort_id)
      base ? "#{base} (#{cohort_name})" : name
    elsif base
      "#{base}#{COPY_SUFFIX}"
    else
      name.gsub(cohort_name, "another cohort")
    end
  end

  # { id:, name: } for a payload, or nil.
  def ref(curriculum)
    curriculum && { id: curriculum.id, name: self.for(curriculum) }
  end

  private

  def visible?(cohort_id)
    return false if @viewer.nil? || @viewer.archived?
    return true if @viewer.admin?

    @visible_ids ||= @viewer.accessible_cohorts.pluck(:id).to_set
    @visible_ids.include?(cohort_id)
  end
end
