import { unavailableResponse } from '../../lib/loadFailure'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { DISCARD_DRAFT_CONFIRMATION, REDO_NEEDS_FEEDBACK, feedbackDraftDiffers, isBlankFeedback } from '../../lib/submissionQueue'
import { isPreviousAttempt } from '../shared/AttemptReview'
import { leavesPath, useLeaveGuard } from '../../lib/useLeaveGuard'
import { invalidateRecordQueues } from '../../lib/recordQueueCache'
import type { RubricRating, Submission } from '../../types/api'
import { gradeChoicesFor, gradeFromRubric, normalizeGradingScale, type GradeChoice } from '../../lib/gradingScale'
import { gradeLabel } from '../../lib/glossary'

type CriteriaDraft = Record<number, { rating: RubricRating | null; feedback: string }>
function criteriaFor(submission: Submission): CriteriaDraft {
  return Object.fromEntries(
    (submission.rubric?.criteria || []).map((criterion) => [
      criterion.id,
      { rating: criterion.rating || null, feedback: criterion.feedback || '' },
    ]),
  )
}

/** The single web grading writer. A conflict never discards or silently resubmits a draft. */
export function useSubmissionReview(
  submissionId: number,
  onSaved?: (submission: Submission) => void,
  /** Which navigations replace this review; an inline review also goes when its selection param changes. */
  leaves: Parameters<typeof useLeaveGuard>[0]['blocks'] = leavesPath,
) {
  const confirm = useConfirm()
  const toast = useToast()
  const generation = useRef(0)
  // Independent generation for silent background refreshes so they never invalidate an active grade save.
  const quietGeneration = useRef(0)
  const saving = useRef(false)
  // Counts saved grades, so a GitHub refresh that started before one can tell it is out of date.
  const saves = useRef(0)
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [feedback, setFeedback] = useState('')
  const [criteria, setCriteria] = useState<CriteriaDraft>({})
  const [selectedGrade, setSelectedGradeState] = useState<GradeChoice | null>(null)
  // Whether the chosen grade came from the rubric ratings. Choosing a grade by hand stops the
  // rubric from changing it again; loading or saving a review starts over.
  const [gradeSource, setGradeSource] = useState<'rubric' | 'manual' | null>(null)
  const setSelectedGrade = useCallback((value: GradeChoice | null) => {
    setSelectedGradeState(value)
    setGradeSource(value ? 'manual' : null)
  }, [])
  const [overrideReason, setOverrideReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [noAccess, setNoAccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  // The draft as last rendered, for a draft-keeping reload (which runs after an await).
  const draft = useRef({ criteria, gradeSource, selectedGrade })
  useEffect(() => {
    draft.current = { criteria, gradeSource, selectedGrade }
  })

  const load = useCallback(
    async (preserveDraft = false, quiet = false) => {
      if (quiet && saving.current) return
      const request = quiet ? generation.current : ++generation.current
      const quietRequest = ++quietGeneration.current
      const saveGen = saves.current
      const isCurrent = () =>
        quiet
          ? request === generation.current &&
            quietRequest === quietGeneration.current &&
            !saving.current &&
            saves.current === saveGen
          : request === generation.current
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        if (!Number.isInteger(submissionId) || submissionId <= 0)
          throw new Error('This submission link is invalid.')
        const result = await api.getSubmission(submissionId)
        if (!isCurrent()) return
        if (quiet && (!result || !result.data || result.error || result.fromCache)) return
        setNoAccess(unavailableResponse(result))
        if (unavailableResponse(result)) { setSubmission(null); return }
        if (!result.data || result.error || result.fromCache)
          throw new Error(result.error || 'Could not load submission details.')
        const next = result.data.submission
        setSubmission(next)
        if (!preserveDraft) {
          setFeedback(next.feedback || '')
          setCriteria(criteriaFor(next))
          setSelectedGradeState(null)
          setGradeSource(null)
          setOverrideReason(next.grade_suggestion?.override_reason || '')
        } else {
          const kept = draft.current
          const merged: CriteriaDraft = Object.fromEntries(
            Object.entries(criteriaFor(next)).map(([id, value]) => [id, kept.criteria[Number(id)] || value]),
          )
          setCriteria(merged)
          // A grade the rubric picked follows the merged ratings on the saved record's scale; a grade
          // chosen by hand stays unless that scale no longer offers it (then the reviewer picks again).
          if (kept.gradeSource === 'rubric') {
            const suggested = gradeFromRubric(next.grading_scale, (next.rubric?.criteria || []).map((criterion) => merged[criterion.id]?.rating))
            setSelectedGradeState(suggested)
            setGradeSource(suggested ? 'rubric' : null)
          } else if (kept.selectedGrade && !gradeChoicesFor(next.grading_scale).includes(kept.selectedGrade)) {
            setSelectedGradeState(null)
            setGradeSource(null)
          }
        }
        setConflict(false)
      } catch (cause) {
        if (!quiet && request === generation.current)
          setError(cause instanceof Error ? cause.message : 'Could not load submission details.')
      } finally {
        if (!quiet && request === generation.current) setLoading(false)
      }
    },
    [submissionId],
  )

  useEffect(() => {
    setSubmission(null)
    setSelectedGradeState(null)
    setGradeSource(null)
    setOverrideReason('')
    saving.current = false
    void load()
    return () => {
      generation.current += 1
      quietGeneration.current += 1
    }
  }, [load])

  // Every way out (links, browser Back, a query change that swaps the review) asks first.
  // A chosen grade is a draft too: Save is the only way to keep it (UX-1).
  const guard = useLeaveGuard({
    dirty:
      selectedGrade !== null ||
      feedbackDraftDiffers(submission, feedback, criteria) ||
      overrideReason.trim() !== (submission?.grade_suggestion?.override_reason || ''),
    blocks: leaves,
    // A grade in flight is neither saved nor safe to abandon.
    confirm: async () => !saving.current && (await confirm(DISCARD_DRAFT_CONFIRMATION)),
  })
  const confirmLeave = async () => !saving.current && (await guard.confirmLeave())

  // The Redo message goes as soon as there is feedback to send.
  useEffect(() => {
    if (!isBlankFeedback(feedback)) setError((current) => (current === REDO_NEEDS_FEEDBACK ? null : current))
  }, [feedback])

  const unratedCriteria = (submission?.rubric?.criteria || []).filter((criterion) => !criteria[criterion.id]?.rating)
  const gradingScale = normalizeGradingScale(submission?.grading_scale)
  /** Rate one rubric criterion; until a grade is chosen by hand, the rubric picks the matching grade. */
  function rateCriterion(criterionId: number, rating: RubricRating) {
    const next = { ...criteria, [criterionId]: { rating, feedback: criteria[criterionId]?.feedback || '' } }
    setCriteria(next)
    if (gradeSource === 'manual' || !submission?.rubric) return
    const suggested = gradeFromRubric(gradingScale, submission.rubric.criteria.map((criterion) => next[criterion.id]?.rating))
    setSelectedGradeState(suggested)
    setGradeSource(suggested ? 'rubric' : null)
  }
  async function grade(
    value: string,
    options?: {
      suggestionDecision?: 'accepted' | 'overridden' | 'dismissed'
      suggestionOverrideReason?: string
    },
  ): Promise<'saved' | 'needs_feedback' | 'needs_rubric' | 'not_saved'> {
    if (!submission || loading || conflict || saving.current || isPreviousAttempt(submission))
      return 'not_saved'
    const rubricCriteria = submission.rubric?.criteria || []
    const redo = value === 'R'
    // A redo needs written feedback so the student knows what to change; rubric ratings stay optional (U-0.4).
    if (redo && isBlankFeedback(feedback)) {
      setError(REDO_NEEDS_FEEDBACK)
      return 'needs_feedback'
    }
    if (!redo && unratedCriteria.length) {
      setError(
        gradingScale === 'pass_redo'
          ? 'Rate every rubric criterion before choosing Pass. A redo only needs written feedback.'
          : 'Rate every rubric criterion before grading A, B, or C. A redo only needs written feedback.',
      )
      return 'needs_rubric'
    }
    // A redo may leave criteria unrated, but a comment needs a rating to be stored.
    if (redo && rubricCriteria.some((criterion) => !criteria[criterion.id]?.rating && criteria[criterion.id]?.feedback.trim())) {
      setError('Rate the criteria you commented on, or clear those comments, before requesting a redo.')
      return 'not_saved'
    }
    const ratedCriteria = rubricCriteria
      .filter((criterion) => criteria[criterion.id]?.rating)
      .map((criterion) => ({
        rubric_criterion_id: criterion.id,
        rating: criteria[criterion.id].rating!,
        feedback: criteria[criterion.id].feedback,
      }))
    const includeOverrideReason = options !== undefined && 'suggestionOverrideReason' in options && options.suggestionOverrideReason !== undefined
    const trimmedOverrideReason = includeOverrideReason ? options.suggestionOverrideReason!.trim() : undefined
    setError(null)
    quietGeneration.current += 1
    saving.current = true
    setGrading(true)
    const request = generation.current
    try {
      const result = await api.gradeSubmission(submission.id, {
        grade: value,
        feedback,
        base_submission_updated_at: submission.updated_at,
        // No ratings on a redo: omit the field so the server keeps any earlier evidence.
        criterion_results: ratedCriteria.length || !redo ? ratedCriteria : undefined,
        ...(options?.suggestionDecision ? { suggestion_decision: options.suggestionDecision } : {}),
        ...(includeOverrideReason ? { suggestion_override_reason: trimmedOverrideReason } : {}),
      })
      if (request !== generation.current) return 'not_saved'
      if (!result.data || result.error) {
        setError(result.error || 'Could not save this grade.')
        if (result.latestSubmissionId && result.latestSubmissionId !== submission.id)
          setSubmission({ ...submission, latest_submission_id: result.latestSubmissionId })
        else if (result.status === 409) setConflict(true)
        return 'not_saved'
      }
      saves.current += 1
      setSubmission(result.data.submission)
      setFeedback(result.data.submission.feedback || '')
      setCriteria(criteriaFor(result.data.submission))
      setSelectedGradeState(null)
      setGradeSource(null)
      setOverrideReason(result.data.submission.grade_suggestion?.override_reason || '')
      const saved = result.data.submission
      const delivery = saved.github_issue_delivery
      const pendingIssue = delivery?.status === 'pending' && delivery.updated_at !== submission.github_issue_delivery?.updated_at
      if (pendingIssue && value === 'R' && delivery.action === 'open_or_comment')
        toast.success('Redo saved · GitHub issue queued')
      else if (pendingIssue && value !== 'R' && delivery.action === 'close')
        toast.success('Grade saved · GitHub issue will close')
      else
        toast.success(saved.user_name ? `Saved ${gradeLabel(value)} for ${saved.user_name}` : `Saved ${gradeLabel(value)}`)
      // Saved: Save and next may navigate before the clean draft renders.
      guard.release()
      // Every queue that listed this submission is out of date; the next record asks again.
      invalidateRecordQueues()
      onSaved?.(result.data.submission)
      return 'saved'
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not save this grade.')
      return 'not_saved'
    } finally {
      if (request === generation.current) {
        saving.current = false
        setGrading(false)
      }
    }
  }

  return {
    noAccess,
    submission,
    setSubmission,
    feedback,
    setFeedback,
    criteria,
    setCriteria,
    unratedCriteria,
    selectedGrade,
    setSelectedGrade,
    /** True while the chosen grade is the one the rubric ratings point to. */
    gradeFromRubric: gradeSource === 'rubric' && selectedGrade !== null,
    rateCriterion,
    gradingScale,
    overrideReason,
    setOverrideReason,
    loading,
    grading,
    error,
    setError,
    conflict,
    load,
    confirmLeave,
    keepGuarding: guard.rearm,
    grade,
    /** How many grades this review has saved; compare before and after an async refresh. */
    saveGeneration: () => saves.current,
  }
}
