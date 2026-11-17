import { CheckCircle2, Code, ExternalLink, FileText, GitBranch, Globe, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { api } from '../../lib/api'
import { namedLanguage } from '../../lib/codeLanguage'
import { codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { formatShortDateTime } from '../../lib/format'
import { friendlySaveError } from '../../lib/friendlyError'
import { blockHeaderParts } from '../../lib/learnerLabels'
import { submissionStatus } from '../../lib/learningStatus'
import { reviewTiming } from '../../lib/reviewCopy'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useStudentExperience } from '../../lib/studentExperience'
import { clearSubmissionDraft, readSubmissionDraft, submissionDraftKey, writeSubmissionDraft } from '../../lib/submissionDrafts'
import { effectiveSubmissionType } from '../../lib/submissionType'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Button } from '../ui/Button'
import { detectLanguage } from './CodeEditor'
import type { ContentBlock, ContentBlockRendererProps } from './contentBlockTypes'
import type { StarterLinkContext } from './HafaStarterLink'
import { useKnowledgeCheckBlock } from './useKnowledgeCheckBlock'
import { useVideoBlock } from './useVideoBlock'
export function useContentBlockController({ block, cohortId, isStaff, requiresGithub, requiresSubmission = true, readOnly = false, submissionsLocked = false, submissionWeekNumber, analyticsContext, lessonReturn, starterOpensNewTab = false, onProgressUpdate }: ContentBlockRendererProps) {
  const toast = useToast()
  const { user, enrollments } = useAuthContext()
  const studentExperience = useStudentExperience()
  const v2 = studentExperience.v2
  const touch = useMediaQuery('(pointer: coarse)')
  const [revisionOpen, setRevisionOpen] = useState(false)
  const reviewResponseTime = enrollments?.find(entry => entry.cohort.id === cohortId)?.cohort.review_response_time || 'usually reviewed within 2 days'
  const draftKey = submissionDraftKey({ userId: user?.id, cohortId, blockId: block.id })
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null)
  const [savedAttempt, setSavedAttempt] = useState<{ key: string; value: NonNullable<ContentBlock['submissions']>[number] } | null>(null)
  const serverSubmissions = block.submissions ?? []
  const serverLatest = serverSubmissions[0]
  // A successful PATCH keeps its ID. Hold its response until the parent refresh
  // catches up, so clearing the draft cannot restore the old saved content.
  const pendingSavedAttempt = savedAttempt?.key === draftKey && (!serverLatest || savedAttempt.value.id > serverLatest.id ||
    Date.parse(savedAttempt.value.updated_at || savedAttempt.value.created_at) > Date.parse(serverLatest.updated_at || serverLatest.created_at))
  const submissions = pendingSavedAttempt
    ? [savedAttempt.value, ...serverSubmissions.filter((submission) => submission.id !== savedAttempt.value.id)]
    : serverSubmissions
  const latestSubmission = submissions[0] || null
  const hasRedoRequest = v2 && !pendingSavedAttempt ? block.learner_state === 'redo_requested' : latestSubmission?.grade === 'R'
  const canEditSubmission = !latestSubmission?.grade || hasRedoRequest
  const [isCompleted, setIsCompleted] = useState(block.progress?.status === 'completed')
  const [showSolution, setShowSolution] = useState(false)
  const [submissionText, setSubmissionText] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [prUrl, setPrUrl] = useState('')
  const [liveUrl, setLiveUrl] = useState('')
  const [branchName, setBranchName] = useState('')
  const [commitSha, setCommitSha] = useState('')
  const [submissionNotes, setSubmissionNotes] = useState('')
  const [showAdvancedRepoFields, setShowAdvancedRepoFields] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionRetryable, setSubmissionRetryable] = useState(false)
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null)
  const [hasEditedSubmissionDraft, setHasEditedSubmissionDraft] = useState(false)
  const trackedFeedbackRef = useRef<number | null>(null)
  useEffect(() => {
    setIsCompleted(block.progress?.status === 'completed')
  }, [block.id, block.progress?.status])

  useEffect(() => {
    if (!analyticsContext || !latestSubmission?.grade || trackedFeedbackRef.current === latestSubmission.id) return
    trackedFeedbackRef.current = latestSubmission.id
    captureProductEvent('feedback_viewed', {
      submission_id: latestSubmission.id,
      grade_state: latestSubmission.grade === 'R' ? 'redo' : 'passed',
      age_bucket: analyticsAgeBucket(latestSubmission.graded_at),
    })
  }, [analyticsContext, latestSubmission?.grade, latestSubmission?.graded_at, latestSubmission?.id])

  const { knowledgeCheck, selectedCheckOption, setSelectedCheckOption, checkingAnswer, checkError, setCheckError, handleKnowledgeCheck } = useKnowledgeCheckBlock({ block, cohortId, isStaff, readOnly, onProgressUpdate, isCompleted, setIsCompleted })
  const { activeVideoSegment, completedVideoSegment, vimeoContainerRef, ytIframeRef, s3VideoRef, videoSegments, initialVideoPosition, finishActiveVideoSegment, fetchBlockStreamUrl, saveBlockProgress, handleVideoSegmentSelect } = useVideoBlock({ block, cohortId, isStaff, readOnly, analyticsContext, onProgressUpdate, isCompleted, setIsCompleted })

  const isExerciseType = block.block_type === 'exercise' || block.block_type === 'code_challenge'
  // Checkpoints with an explicit reviewed submission type (the Python pilot's
  // weekly checkpoints) are graded work, exactly like an exercise.
  const isSubmissionCheckpoint = block.block_type === 'checkpoint' && !knowledgeCheck &&
    ['text_submission', 'repo_url_submission', 'repo_and_live_url_submission'].includes(block.submission_type || '')
  const isWorkBlock = isExerciseType || isSubmissionCheckpoint
  const detectedLang = detectLanguage(block.filename, block.metadata?.language)
  const runnerFallbackLanguage = codeRunnerLanguageFromEditor(detectedLang) || 'ruby'
  const runnerConfig = normalizeCodeRunnerConfig(block.submission_config, runnerFallbackLanguage)
  // A written answer (the exercise names a Markdown file or language) gets the two-mode editor;
  // code keeps the code editor, where Rich mode would escape the source and the runner needs it raw.
  const writtenSubmission = namedLanguage(block.filename, block.metadata?.language) === 'markdown' && !runnerConfig.enabled
  const submissionType = effectiveSubmissionType(block, requiresGithub, requiresSubmission)
  const usesManualExerciseCompletion = isExerciseType && submissionType === 'manual_complete'
  const usesGithubSyncSubmission = isExerciseType && submissionType === 'prework_github_sync'
  const usesTextSubmission = isWorkBlock && submissionType === 'text_submission'
  const usesRepoArtifactSubmission = isWorkBlock && (submissionType === 'repo_url_submission' || submissionType === 'repo_and_live_url_submission')
  const requiresLiveUrl = submissionType === 'repo_and_live_url_submission'
  const workLocked = readOnly || submissionsLocked && (isWorkBlock || (block.block_type === 'checkpoint' && !knowledgeCheck))
  const lessonReturnUrl = lessonReturn?.url
  const lessonReturnLabel = lessonReturn?.label
  // "Paste it here" only when this learner has an open text box to paste into.
  const starterHint = usesTextSubmission && canEditSubmission && !isStaff && !workLocked ? 'submit' : 'practice'
  const starterLinks = useMemo<StarterLinkContext | undefined>(
    () => (lessonReturnUrl ? { lessonReturn: { url: lessonReturnUrl, label: lessonReturnLabel }, hint: starterHint, newTab: starterOpensNewTab } : undefined),
    [lessonReturnUrl, lessonReturnLabel, starterHint, starterOpensNewTab],
  )
  const latestStatus = v2 && !pendingSavedAttempt ? ({ submitted: 'awaiting_review', redo_requested: 'redo', complete: 'done' } as const)[block.learner_state as 'submitted' | 'redo_requested' | 'complete'] : submissionStatus(latestSubmission)
  const editAnswer = !v2 || !latestSubmission || hasRedoRequest || revisionOpen || hasEditedSubmissionDraft
  const lockCopy = readOnly ? 'Review only' : submissionWeekNumber ? `Week ${submissionWeekNumber} submissions are closed` : 'Submissions are closed'

  const handleDraftChange = useCallback((updater: () => void) => {
    setHasEditedSubmissionDraft(true)
    setSubmissionError(null)
    setSubmissionSuccess(null)
    updater()
  }, [])

  useEffect(() => {
    if (hasEditedSubmissionDraft) return

    // A draft kept on this device (after a failed submit, a reload, or leaving
    // the page) wins over the last saved submission.
    const draft = !isStaff && (usesTextSubmission || usesRepoArtifactSubmission) ? readSubmissionDraft(draftKey) : null
    const same = (a?: string | null, b?: string | null) => (a ?? '') === (b ?? '')
    const draftDiffers = draft && (usesTextSubmission
      ? !same(draft.text, latestSubmission?.text)
      : !same(draft.repoUrl, latestSubmission?.repo_url) || !same(draft.prUrl, latestSubmission?.pr_url) ||
        !same(draft.liveUrl, latestSubmission?.live_url) || !same(draft.branch, latestSubmission?.branch) ||
        !same(draft.commitSha, latestSubmission?.commit_sha) || !same(draft.notes, latestSubmission?.notes))
    // A draft older than the latest saved submission (for example, work later
    // submitted from another device) is stale and must not replace it.
    const draftIsStale = Boolean(draft && latestSubmission && Date.parse(draft.savedAt) < Date.parse(latestSubmission.created_at))
    if (draft && draftDiffers && !draftIsStale) {
      setSubmissionText(draft.text ?? '')
      setRepoUrl(draft.repoUrl ?? '')
      setPrUrl(draft.prUrl ?? '')
      setLiveUrl(draft.liveUrl ?? '')
      setBranchName(draft.branch ?? '')
      setCommitSha(draft.commitSha ?? '')
      setSubmissionNotes(draft.notes ?? '')
      setShowAdvancedRepoFields(Boolean(draft.prUrl || draft.branch || draft.commitSha))
      setRestoredDraftAt(draft.savedAt)
      setHasEditedSubmissionDraft(true)
      return
    }
    if (draft) clearSubmissionDraft(draftKey)

    setSubmissionText(usesTextSubmission ? latestSubmission?.text ?? '' : '')
    setRepoUrl(usesRepoArtifactSubmission ? latestSubmission?.repo_url ?? '' : '')
    setPrUrl(usesRepoArtifactSubmission ? latestSubmission?.pr_url ?? '' : '')
    setLiveUrl(usesRepoArtifactSubmission ? latestSubmission?.live_url ?? '' : '')
    setBranchName(usesRepoArtifactSubmission ? latestSubmission?.branch ?? '' : '')
    setCommitSha(usesRepoArtifactSubmission ? latestSubmission?.commit_sha ?? '' : '')
    setSubmissionNotes(usesRepoArtifactSubmission ? latestSubmission?.notes ?? '' : '')
    setShowAdvancedRepoFields(Boolean(
      usesRepoArtifactSubmission && (
        latestSubmission?.pr_url ||
        latestSubmission?.branch ||
        latestSubmission?.commit_sha ||
        latestSubmission?.notes ||
        (!requiresLiveUrl && latestSubmission?.live_url)
      )
    ))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, draftKey, hasEditedSubmissionDraft, isStaff, latestSubmission?.id, requiresLiveUrl, usesRepoArtifactSubmission, usesTextSubmission])

  const resetBlockIdRef = useRef(block.id)
  useEffect(() => {
    // Only reset when the renderer is reused for a different block; on mount
    // the draft-restore effect above has already set the initial state.
    if (resetBlockIdRef.current === block.id) return
    resetBlockIdRef.current = block.id
    setHasEditedSubmissionDraft(false)
    setSubmissionError(null)
    setSubmissionSuccess(null)
    setRestoredDraftAt(null)
  }, [block.id])

  // Debounced draft saving; anything still pending is flushed on unmount so
  // leaving the lesson right after typing does not lose the last edits.
  const pendingDraftRef = useRef<{ key: string; draft: Parameters<typeof writeSubmissionDraft>[1] } | null>(null)
  useEffect(() => {
    const flush = () => {
      const pending = pendingDraftRef.current
      if (pending) writeSubmissionDraft(pending.key, pending.draft)
    }
    // A hard reload does not unmount React. Flush before the browser leaves,
    // including when the student reloads inside the 300ms debounce window.
    if (v2) {
      window.addEventListener('beforeunload', flush)
      window.addEventListener('pagehide', flush)
    }
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [v2])
  useEffect(() => {
    if (isStaff || !hasEditedSubmissionDraft || !(usesTextSubmission || usesRepoArtifactSubmission)) return
    const pending = {
      key: draftKey,
      draft: usesTextSubmission
        ? { text: submissionText }
        : { repoUrl, prUrl, liveUrl, branch: branchName, commitSha, notes: submissionNotes },
    }
    pendingDraftRef.current = pending
    const timer = window.setTimeout(() => {
      writeSubmissionDraft(pending.key, pending.draft)
      if (pendingDraftRef.current === pending) pendingDraftRef.current = null
    }, 300)
    return () => window.clearTimeout(timer)
  }, [branchName, commitSha, draftKey, hasEditedSubmissionDraft, isStaff, liveUrl, prUrl, repoUrl, submissionNotes, submissionText, usesRepoArtifactSubmission, usesTextSubmission])

  const discardDraft = () => {
    pendingDraftRef.current = null
    clearSubmissionDraft(draftKey)
    setRestoredDraftAt(null)
    setSubmissionError(null)
    setHasEditedSubmissionDraft(false)
  }

  const blockIcons: Record<string, React.ReactNode> = {
    video: <Play className="h-4 w-4" />,
    text: <FileText className="h-4 w-4" />,
    exercise: <Code className="h-4 w-4" />,
    code_challenge: <Code className="h-4 w-4" />,
    checkpoint: <CheckCircle2 className="h-4 w-4" />,
    recording: <Play className="h-4 w-4" />,
  }

  const handleToggleComplete = async () => {
    if (isStaff || readOnly) return
    if (workLocked && !isCompleted) {
      toast.error(`${lockCopy}. You can still review the lesson, but new work cannot be marked complete.`)
      return
    }

    const newStatus = isCompleted ? 'not_started' : 'completed'
    const res = await api.updateProgress(block.id, newStatus, cohortId)
    if (!res.error) {
      setIsCompleted(!isCompleted)
      if (newStatus === 'completed' && analyticsContext) captureProductEvent('learning_step_completed', {
        module_id: analyticsContext.moduleId,
        lesson_id: analyticsContext.lessonId,
        content_block_id: block.id,
        block_type: block.block_type,
        source: 'manual',
      })
      onProgressUpdate?.()
      if (!v2) toast.success(newStatus === 'completed' ? 'Marked complete' : 'Marked incomplete')
    } else {
      toast.error(res.error)
    }
  }

  const handleSubmit = async () => {
    if (isStaff || !canEditSubmission) return

    setSubmissionError(null)
    setSubmissionRetryable(false)
    setSubmissionSuccess(null)

    if (workLocked) {
      const message = `${lockCopy}. You can still review the lesson and existing feedback, but new submissions are disabled.`
      setSubmissionError(message)
      toast.error(message)
      return
    }

    if (usesTextSubmission && !submissionText.trim()) {
      setSubmissionError('Please enter your solution before submitting.')
      return
    }
    if (usesRepoArtifactSubmission && !repoUrl.trim()) {
      setSubmissionError('Please provide a repository URL before submitting.')
      return
    }
    if (requiresLiveUrl && !liveUrl.trim()) {
      setSubmissionError('Please provide a live URL before submitting.')
      return
    }

    setIsSubmitting(true)
    const payload = {
      cohort_id: cohortId,
      ...(usesTextSubmission ? { text: submissionText } : {}),
      ...(usesRepoArtifactSubmission ? {
        repo_url: repoUrl.trim(),
        pr_url: prUrl.trim(),
        live_url: liveUrl.trim(),
        branch: branchName.trim(),
        commit_sha: commitSha.trim(),
        notes: submissionNotes.trim(),
      } : {}),
    }
    const editing = latestSubmission && latestSubmission.grade === null
    const res = editing
      ? await api.updateSubmission(latestSubmission.id, payload)
      : await api.createSubmission({ ...payload, content_block_id: block.id })
    if (res.error) {
      const message = friendlySaveError(res, isSubmissionCheckpoint ? 'your checkpoint' : 'your submission')
      setSubmissionError(message)
      setSubmissionRetryable(res.errorKind === 'network' || res.errorKind === 'timeout' || res.errorKind === 'server')
      // Keep the draft on this device right away so a reload cannot lose it.
      writeSubmissionDraft(draftKey, usesTextSubmission
        ? { text: submissionText }
        : { repoUrl, prUrl, liveUrl, branch: branchName, commitSha, notes: submissionNotes })
      toast.error(isSubmissionCheckpoint ? 'Your checkpoint was not sent yet.' : 'Your submission was not sent yet.')
    } else {
      pendingDraftRef.current = null
      clearSubmissionDraft(draftKey)
      setRestoredDraftAt(null)
      const savedSubmission = res.data?.submission
      if (savedSubmission) setSavedAttempt({ key: draftKey, value: savedSubmission })
      setHasEditedSubmissionDraft(false)
      const attempt = savedSubmission?.num_submissions || (latestSubmission?.num_submissions || 0) + 1
      if (!editing) captureProductEvent('submission_created', {
        content_block_id: block.id,
        submission_type: submissionType,
        attempt,
      })
      if (hasRedoRequest && latestSubmission) captureProductEvent('redo_submitted', {
        submission_id: savedSubmission?.id || latestSubmission.id,
        attempt,
        age_bucket: analyticsAgeBucket(latestSubmission.graded_at),
      })
      if (!editing && analyticsContext) captureProductEvent('learning_step_completed', {
        module_id: analyticsContext.moduleId,
        lesson_id: analyticsContext.lessonId,
        content_block_id: block.id,
        block_type: block.block_type,
        source: 'submission',
      })
      const message = editing ? 'Updated.' : latestSubmission ? 'Resubmitted.' : 'Submitted.'
      const reviewMessage = `${message} Your instructor will review it — ${reviewTiming(reviewResponseTime)}. Feedback will appear here.`
      setRevisionOpen(false)
      if (!v2) { setSubmissionSuccess(reviewMessage); toast.success(reviewMessage) }
      onProgressUpdate?.()
    }
    setIsSubmitting(false)
  }

  const submissionArtifacts = (sub: typeof latestSubmission) => {
    if (!sub) return null

    return (
      <div className="space-y-2">
        {(sub.github_code_url || sub.repo_url || sub.pr_url || sub.live_url) && (
          <div className="flex flex-wrap gap-2">
            {sub.github_code_url && (
              <a href={sanitizeUrl(sub.github_code_url)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink">
                <Code className="h-3 w-3" />
                GitHub Code
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.repo_url && (
              <a href={sanitizeUrl(sub.repo_url)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink">
                <Code className="h-3 w-3" />
                Repo
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.pr_url && (
              <a href={sanitizeUrl(sub.pr_url)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink">
                <GitBranch className="h-3 w-3" />
                PR
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.live_url && (
              <a href={sanitizeUrl(sub.live_url)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink">
                <Globe className="h-3 w-3" />
                Live
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
        {(sub.branch || sub.commit_sha || sub.notes) && (
          <div className="space-y-1 rounded-lg border border-line bg-surface-raised p-3 text-sm text-ink-secondary">
            {sub.branch && <p><span className="font-medium text-ink">Branch:</span> {sub.branch}</p>}
            {sub.commit_sha && <p><span className="font-medium text-ink">Commit:</span> <span className="font-mono">{sub.commit_sha}</span></p>}
            {sub.notes && <p className="whitespace-pre-wrap"><span className="font-medium text-ink">Notes:</span> {sub.notes}</p>}
          </div>
        )}
      </div>
    )
  }

  const submissionStatusMessage = (submissionError || submissionSuccess || restoredDraftAt) ? (
    <div aria-live="polite" className="space-y-2">
      {restoredDraftAt && !submissionError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info-line bg-info-soft py-1 pl-3 pr-1 text-sm text-info-ink">
          <p className="py-1.5">Restored your unsent draft from <span className="tabular-nums">{formatShortDateTime(restoredDraftAt, 'earlier')}</span>.</p>
          <Button variant="quiet" size="sm" onClick={discardDraft} className="text-info-ink! hover:bg-info-soft!">Discard draft</Button>
        </div>
      )}
      {submissionError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger-line bg-danger-soft py-1 pl-3 pr-1 text-sm text-danger-ink">
          <p className="min-w-0 flex-1 py-1.5">{submissionError}</p>
          {submissionRetryable && (
            <Button variant="danger" size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      )}
      {submissionSuccess && !submissionError && (
        <div className="rounded-xl border border-success-line bg-success-soft px-3 py-2 text-sm text-success-ink">{submissionSuccess}</div>
      )}
    </div>
  ) : null

  const header = blockHeaderParts(block.block_type, block.title)


  // Shared state stays mounted across parent refreshes and block-id changes, as before.
  return {
    studentExperience, v2, touch, setRevisionOpen, reviewResponseTime, submissions,
    latestSubmission, hasRedoRequest, canEditSubmission, isCompleted, showSolution, setShowSolution,
    submissionText, setSubmissionText, repoUrl, setRepoUrl, prUrl, setPrUrl,
    liveUrl, setLiveUrl, branchName, setBranchName, commitSha, setCommitSha,
    submissionNotes, setSubmissionNotes, showAdvancedRepoFields, setShowAdvancedRepoFields, isSubmitting, hasEditedSubmissionDraft,
    knowledgeCheck, selectedCheckOption, setSelectedCheckOption, checkingAnswer, checkError, setCheckError,
    activeVideoSegment, completedVideoSegment, vimeoContainerRef, ytIframeRef, s3VideoRef, isSubmissionCheckpoint,
    isWorkBlock, detectedLang, runnerConfig, writtenSubmission, submissionType, usesManualExerciseCompletion,
    usesGithubSyncSubmission, usesTextSubmission, usesRepoArtifactSubmission, requiresLiveUrl, workLocked, starterLinks,
    latestStatus, editAnswer, lockCopy, videoSegments, initialVideoPosition, finishActiveVideoSegment,
    handleDraftChange, blockIcons, handleToggleComplete, fetchBlockStreamUrl, saveBlockProgress, handleVideoSegmentSelect,
    handleSubmit, handleKnowledgeCheck, submissionArtifacts, submissionStatusMessage, header,
  }
}
export type ContentBlockController = ReturnType<typeof useContentBlockController>
