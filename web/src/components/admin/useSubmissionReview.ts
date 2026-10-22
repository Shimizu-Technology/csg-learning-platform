import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { DISCARD_DRAFT_CONFIRMATION, feedbackDraftDiffers } from '../../lib/submissionQueue'
import { isPreviousAttempt } from '../shared/AttemptReview'
import type { RubricRating, Submission } from '../../types/api'

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
) {
  const confirm = useConfirm()
  const toast = useToast()
  const generation = useRef(0)
  const saving = useRef(false)
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [feedback, setFeedback] = useState('')
  const [criteria, setCriteria] = useState<CriteriaDraft>({})
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const load = useCallback(
    async (preserveDraft = false) => {
      const request = ++generation.current
      setLoading(true)
      setError(null)
      try {
        if (!Number.isInteger(submissionId) || submissionId <= 0)
          throw new Error('This submission link is invalid.')
        const result = await api.getSubmission(submissionId)
        if (request !== generation.current) return
        if (!result.data || result.error || result.fromCache)
          throw new Error(result.error || 'Could not load submission details.')
        const next = result.data.submission
        setSubmission(next)
        if (!preserveDraft) {
          setFeedback(next.feedback || '')
          setCriteria(criteriaFor(next))
        } else {
          setCriteria((current) =>
            Object.fromEntries(
              Object.entries(criteriaFor(next)).map(([id, value]) => [
                id,
                current[Number(id)] || value,
              ]),
            ),
          )
        }
        setConflict(false)
      } catch (cause) {
        if (request === generation.current)
          setError(cause instanceof Error ? cause.message : 'Could not load submission details.')
      } finally {
        if (request === generation.current) setLoading(false)
      }
    },
    [submissionId],
  )

  useEffect(() => {
    setSubmission(null)
    saving.current = false
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  const confirmLeave = async () =>
    !saving.current &&
    (!feedbackDraftDiffers(submission, feedback, criteria) ||
      (await confirm(DISCARD_DRAFT_CONFIRMATION)))

  async function grade(value: string) {
    if (!submission || loading || conflict || saving.current || isPreviousAttempt(submission))
      return
    if (submission.rubric?.criteria.some((criterion) => !criteria[criterion.id]?.rating)) {
      setError('Rate every rubric criterion before grading.')
      return
    }
    setError(null)
    saving.current = true
    setGrading(true)
    const request = generation.current
    try {
      if (value === 'R' && !feedback.trim()) {
        const accepted = await confirm({
          title: 'Request a redo without feedback?',
          description: "The student won't know what to change.",
          confirmLabel: 'Request redo',
        })
        if (!accepted || request !== generation.current) return
      }
      const result = await api.gradeSubmission(submission.id, {
        grade: value,
        feedback,
        base_submission_updated_at: submission.updated_at,
        criterion_results: (submission.rubric?.criteria || []).map((criterion) => ({
          rubric_criterion_id: criterion.id,
          rating: criteria[criterion.id].rating!,
          feedback: criteria[criterion.id].feedback,
        })),
      })
      if (request !== generation.current) return
      if (!result.data || result.error) {
        setError(result.error || 'Could not save this grade.')
        if (result.latestSubmissionId && result.latestSubmissionId !== submission.id)
          setSubmission({ ...submission, latest_submission_id: result.latestSubmissionId })
        else if (result.status === 409) setConflict(true)
        return
      }
      setSubmission(result.data.submission)
      setFeedback(result.data.submission.feedback || '')
      setCriteria(criteriaFor(result.data.submission))
      toast.success(`Submission graded ${value}.`)
      onSaved?.(result.data.submission)
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not save this grade.')
    } finally {
      if (request === generation.current) {
        saving.current = false
        setGrading(false)
      }
    }
  }

  return {
    submission,
    setSubmission,
    feedback,
    setFeedback,
    criteria,
    setCriteria,
    loading,
    grading,
    error,
    setError,
    conflict,
    load,
    confirmLeave,
    grade,
  }
}
