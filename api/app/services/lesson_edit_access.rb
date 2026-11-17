# Who may change a curriculum's lessons (W5 PR 5.3 part 2; decision 1 in
# docs/design/2026-11-platform-redesign/README.md §12).
#
# - Admins edit every curriculum, including one several cohorts share.
# - An instructor edits only when an admin has turned on lesson editing on
#   their assignment to a cohort (CohortInstructorAssignment#can_edit_lessons)
#   and every cohort that uses the curriculum is one of those cohorts. The
#   grant lives on the assignment row, so removing the instructor from the
#   cohort removes the access too.
# - An instructor whose grants don't cover every cohort sharing the
#   curriculum sees it read-only ("shared"). Everyone else on staff reads.
#
# Write paths check twice: a before_action refuses early, and the save
# re-checks inside its transaction with `lock: true` before it locks the
# lesson. The re-check locks first and decides after, in the order
# Curriculum.lock_for_content! documents:
# - the curriculum row FOR SHARE, so a cohort can't join (or leave) the
#   curriculum between the check and the commit: cohort saves that change
#   membership take FOR UPDATE on it (Cohort#lock_curriculum_for_availability);
# - then the instructor's grant rows FOR SHARE, so a revoke or removal (which
#   updates or deletes the row) waits for a save already in flight, and any
#   save that starts after it sees the access gone.
# Only then are the grants and the cohorts sharing the curriculum read, past
# the query cache (the early check ran the same queries in this request).
#
# Privacy (L-3.2): an instructor sees by name only the sharing cohorts they
# teach. The others are a number (`shared_with_others_count`), in the JSON and
# in the refusal message, so "copy before you edit" still says the curriculum
# is shared without naming a cohort they don't teach. Admins see every name.
class LessonEditAccess
  class Denied < StandardError
    attr_reader :code

    def initialize(access)
      @code = access.refusal_code
      super(access.refusal_message)
    end
  end

  Grant = Data.define(:cohort, :granted_by, :granted_at)

  attr_reader :user, :curriculum, :grants, :sharing_cohorts

  def self.for(user, curriculum, lock: false)
    new(user, curriculum, lock: lock)
  end

  def self.authorize!(user, curriculum, lock: true)
    access = self.for(user, curriculum, lock: lock)
    raise Denied.new(access) unless access.can_edit?

    access
  end

  # Grants that let an instructor upload lesson media before a block exists
  # (generic presign, multipart content uploads). Saving the block is still
  # checked against the lesson's curriculum.
  def self.any_grant?(user)
    return true if user&.admin? && !user.archived?
    return false unless user&.instructor? && !user.archived?

    user.cohort_instructor_assignments.where(can_edit_lessons: true).exists?
  end

  def initialize(user, curriculum, lock: false)
    @user = user
    @curriculum = curriculum
    @grants = []
    @sharing_cohorts = []
    # The locked re-check runs in the same request as the early check and
    # issues the same queries, so it must not answer from the query cache.
    lock ? ActiveRecord::Base.uncached { load!(lock: true) } : load!(lock: false)
  end

  def can_edit?
    reason == "admin" || reason == "granted"
  end

  # admin | granted | shared | no_grant | not_staff
  def reason
    @reason ||= if user.nil? || user.archived?
      "not_staff"
    elsif user.admin?
      "admin"
    elsif !user.instructor?
      "not_staff"
    elsif grants.empty?
      "no_grant"
    elsif sharing_cohorts.empty?
      "granted"
    else
      "shared"
    end
  end

  # Cohorts this staff member could make their own copy for (part 2b,
  # CurriculumCopyForCohort): an instructor's granted cohorts while others
  # share the curriculum; for an admin, every cohort on a curriculum two or
  # more cohorts use.
  def copy_cohorts
    return grants.map(&:cohort) if reason == "shared"
    return [] unless reason == "admin"

    @admin_copy_cohorts ||= begin
      cohorts = Cohort.where(curriculum_id: curriculum.id).order(:start_date, :id).to_a
      cohorts.size > 1 ? cohorts : []
    end
  end

  # When this curriculum is one cohort's own copy: which cohort, and of what.
  def copy_of
    record = CurriculumCopy.includes(:cohort, :source_curriculum).find_by(copy_curriculum_id: curriculum.id)
    return nil unless record

    # The copy's cohort by name only for admins and the instructors who teach it.
    visible = user&.admin? || user&.cohort_instructor_assignments&.exists?(cohort_id: record.cohort_id)
    {
      cohort: visible ? { id: record.cohort.id, name: record.cohort.name } : nil,
      source_curriculum: CurriculumName.new(user).ref(record.source_curriculum),
      created_at: record.created_at.iso8601
    }
  end

  def refusal_code
    case reason
    when "shared" then "curriculum_shared"
    when "no_grant" then "lesson_editing_not_granted"
    else "staff_required"
    end
  end

  # The sharing cohorts this person may see by name: all of them for admins,
  # only the ones they teach for instructors.
  def visible_sharing_cohorts
    return sharing_cohorts if user&.admin?

    @visible_sharing_cohorts ||= begin
      taught = sharing_cohorts.empty? ? [] : user.cohort_instructor_assignments.where(cohort_id: sharing_cohorts.map(&:id)).pluck(:cohort_id)
      sharing_cohorts.select { |cohort| taught.include?(cohort.id) }
    end
  end

  def hidden_sharing_count
    sharing_cohorts.size - visible_sharing_cohorts.size
  end

  # "Cohort 4 and 1 other cohort": named cohorts the viewer may see, the rest as a number.
  def sharing_label
    names = visible_sharing_cohorts.map(&:name)
    hidden = hidden_sharing_count
    names << "#{hidden} other #{hidden == 1 ? 'cohort' : 'cohorts'}" if hidden.positive?
    names.to_sentence
  end

  def refusal_message
    case reason
    when "shared"
      "Other cohorts use this curriculum too (#{sharing_label}). Make a copy for #{grants.map { |grant| grant.cohort.name }.to_sentence(two_words_connector: ' or ', last_word_connector: ', or ')} in Content to change it for that cohort only."
    when "no_grant"
      "Only admins can edit lessons. Ask an admin to give you editing access for your cohort."
    else
      "Staff access required"
    end
  end

  def as_json(*)
    {
      can_edit: can_edit?,
      reason: reason,
      message: can_edit? ? nil : refusal_message,
      grants: grants.map do |grant|
        {
          cohort: { id: grant.cohort.id, name: grant.cohort.name },
          granted_by: grant.granted_by && { id: grant.granted_by.id, full_name: grant.granted_by.full_name },
          granted_at: grant.granted_at&.iso8601
        }
      end,
      shared_with: visible_sharing_cohorts.map { |cohort| { id: cohort.id, name: cohort.name } },
      shared_with_others_count: hidden_sharing_count,
      copy_cohorts: copy_cohorts.map { |cohort| { id: cohort.id, name: cohort.name } },
      copy_of: copy_of
    }
  end

  private

  def load!(lock:)
    Curriculum.lock_for_content!(curriculum.id) if lock
    return unless instructor?

    scope = CohortInstructorAssignment.joins(:cohort)
      .where(user_id: user.id, can_edit_lessons: true, cohorts: { curriculum_id: curriculum.id })
    scope = scope.order(:id).lock("FOR SHARE OF cohort_instructor_assignments") if lock
    @grants = scope.includes(:cohort, :edit_granted_by).map do |assignment|
      Grant.new(cohort: assignment.cohort, granted_by: assignment.edit_granted_by, granted_at: assignment.edit_granted_at)
    end
    return if @grants.empty?

    @sharing_cohorts = Cohort.where(curriculum_id: curriculum.id).where.not(id: @grants.map { |grant| grant.cohort.id }).order(:start_date, :id).to_a
  end

  def instructor?
    user.present? && user.instructor? && !user.archived?
  end
end
