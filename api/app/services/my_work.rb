# A learner's submitted work in one enrollment (L-1.2, U-5.2): what needs them
# (a Redo with its feedback), what waits for an instructor, and what is graded.
# The three lists are LearnerProgress's latest attempts (`redo_submissions`,
# `awaiting_review_submissions`, `graded_submissions`), so My work, Today,
# Learn and the lesson page agree on every status, and each count is its list's
# length. Rows name who graded the work; nothing else about staff is returned.
#
# "Ask about this feedback" goes to someone the learner can message now
# (StaffContact): the grader while they still teach the cohort and nobody has
# blocked anyone, otherwise the cohort's contact. A row with no one to ask
# offers no action; the grader is still named.
#
# Queries: LearnerProgress's fixed set, plus the graders, the reviewer and
# the cohort's message contacts in a fixed few, however many submissions.
class MyWork
  def initialize(enrollment, progress: nil)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @progress = progress || LearnerProgress.new(enrollment)
    @modules = @progress.content.modules.index_by(&:id)
  end

  def call
    needs_you = items(@progress.redo_submissions, "redo")
    waiting = items(@progress.awaiting_review_submissions, "waiting")
    graded = items(@progress.graded_submissions, "graded")
    {
      cohort: { id: @cohort.id, name: @cohort.name },
      read_only: !@enrollment.active?,
      review_response_time: @cohort.effective_review_response_time,
      reviewer: reviewer_json,
      contact: person_json(contact),
      counts: { needs_you: needs_you.size, waiting: waiting.size, graded: graded.size },
      needs_you: needs_you,
      waiting: waiting,
      graded: graded
    }
  end

  # Rows for submissions of one status. Every grader of the learner's latest
  # attempts loads in one query, the first time any list needs one.
  def items(submissions, status)
    submissions.map { |submission| item(submission, status, graders) }
  end

  # Who reviews a cohort's work: its support instructor, else its first active
  # instructor. Learner pages show only the id and name.
  def self.reviewer_for(cohort)
    id = cohort.support_instructor_id
    (id && User.where(id: id, archived_at: nil).where.not(role: :student).first) || cohort.instructors.not_archived.order(:id).first
  end

  def reviewer
    return @reviewer if defined?(@reviewer)

    @reviewer = self.class.reviewer_for(@cohort)
  end

  # The person this learner can message about the course now: the reviewer if
  # eligible, else another current instructor. Nil when nobody is reachable.
  def contact
    return @contact if defined?(@contact)

    candidates = [ reviewer, *instructors ].compact.uniq
    @contact = candidates.find { |person| eligible.include?(person.id) }
  end

  def person_json(person)
    person && { id: person.id, full_name: person.full_name }
  end

  private

  def reviewer_json
    person_json(reviewer)
  end

  # Graders, the reviewer and the cohort's instructors this learner can message now.
  def eligible
    @eligible ||= StaffContact.eligible_ids(@enrollment, [ *graders.keys, reviewer&.id, *instructors.map(&:id) ]).to_set
  end

  def instructors
    @instructors ||= @cohort.instructors.not_archived.order(:id).to_a
  end

  def graders
    @graders ||= begin
      ids = @progress.latest_submissions.values.filter_map(&:graded_by_id).uniq
      ids.empty? ? {} : User.where(id: ids).index_by(&:id)
    end
  end

  def item(submission, status, graders)
    block = submission.content_block
    lesson = block.lesson
    mod = @modules[lesson.module_id]
    entry = @progress.lesson_progress(lesson)
    window = entry.submission_window
    submission_type = block.submission_type_for(@enrollment)
    grader = graders[submission.graded_by_id]
    {
      submission_id: submission.id,
      status: status,
      cohort_id: @cohort.id,
      lesson_id: lesson.id,
      content_block_id: block.id,
      lesson_title: lesson.title,
      block_title: block.display_title(fallback: "Exercise"),
      module_name: mod&.name,
      week: @cohort.self_paced? || @cohort.alumni? || mod.nil? ? nil : (mod.day_offset.to_i + lesson.release_day) / 7 + 1,
      attempt: submission.num_submissions,
      grade: submission.grade,
      feedback: status == "waiting" ? nil : submission.feedback,
      submitted_at: submission.created_at,
      graded_at: submission.graded_at,
      grader: person_json(grader),
      ask_to: status == "waiting" ? nil : person_json(grader && eligible.include?(grader.id) ? grader : contact),
      submission_type: submission_type,
      submissions_closed: window[:submissions_closed],
      can_resubmit: status == "redo" && @enrollment.active? && entry.available && !window[:submissions_closed] && !%w[manual_complete prework_github_sync].include?(submission_type),
      **review_target(submission, status)
    }
  end

  def review_target(submission, status)
    return {} unless status == "waiting" && @cohort.review_sla_business_days.present?

    @review_sla ||= ReviewSla.new(holidays: SchoolSetting.current.review_sla_holidays)
    target = @review_sla.call(submitted_at: submission.created_at, business_days: @cohort.review_sla_business_days)
    { expected_review_on: target[:expected_on], expected_review_by: target[:expected_by] }
  end
end
