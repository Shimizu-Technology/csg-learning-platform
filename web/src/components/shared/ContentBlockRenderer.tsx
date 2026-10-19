import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Player, { type VimeoUrl } from '@vimeo/player'
import { Play, FileText, Code, CheckCircle2, Circle, ChevronDown, ChevronUp, Send, RotateCcw, ExternalLink, Globe, GitBranch, Lock, RefreshCw, History } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { StarterLinkContext } from './HafaStarterLink'
import { FeedbackBody } from './FeedbackBody'
import { StatusBadge } from './StatusBadge'
import { Button } from '../ui/Button'
import { CodeEditor, detectLanguage } from './CodeEditor'
import { CodeRunner } from './CodeRunner'
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer'
import { VideoSegmentControls } from './VideoSegmentControls'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { LessonReturn } from '../../lib/hafaStarterLinks'
import { CODE_RUNNER_TIMEOUT_MS, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { useAuthContext } from '../../contexts/AuthContext'
import { submissionStatus } from '../../lib/learningStatus'
import { clearSubmissionDraft, readSubmissionDraft, submissionDraftKey, writeSubmissionDraft } from '../../lib/submissionDrafts'
import { friendlySaveError } from '../../lib/friendlyError'
import { isVideoSegmentSeekPosition, normalizeVideoSegments, playbackStart, type VideoSegment } from '../../lib/videoSegments'

interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  submission_type?: string | null
  submission_config?: Record<string, any>
  solution?: string | null
  metadata: Record<string, any>
  knowledge_check?: import('../../types/api').KnowledgeCheck | null
  s3_video_key?: string | null
  progress?: { status: string; completed_at: string | null; video_last_position?: number; video_total_watched?: number }
  submissions?: Array<{
    id: number
    submission_type?: string | null
    text: string | null
    grade: string | null
    feedback: string | null
    graded_at: string | null
    github_issue_url?: string | null
    github_code_url?: string | null
    repo_url?: string | null
    pr_url?: string | null
    live_url?: string | null
    branch?: string | null
    commit_sha?: string | null
    notes?: string | null
    num_submissions: number
    created_at: string
  }>
}

const GRADE_LABELS: Record<string, string> = { A: 'Excellent', B: 'Good', C: 'Satisfactory' }

interface ContentBlockRendererProps {
  block: ContentBlock
  cohortId?: number
  isStaff?: boolean
  requiresGithub?: boolean
  requiresSubmission?: boolean
  repositoryName?: string
  submissionsLocked?: boolean
  submissionsCloseAt?: string | null
  submissionWeekNumber?: number
  analyticsContext?: { moduleId: number; lessonId: number }
  /** The lesson this block renders in; Hafa Code starter links return here. */
  lessonReturn?: LessonReturn
  /** Always open Hafa Code starters in a new tab (editor preview keeps unsaved edits). */
  starterOpensNewTab?: boolean
  onProgressUpdate?: () => void
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function getVimeoEmbed(url: string): { id: string; hash?: string } | null {
  const match = url.match(/vimeo\.com\/(\d+)(?:\/([a-zA-Z0-9]+))?/) 
  if (!match) return null
  return { id: match[1], hash: match[2] }
}

export function ContentBlockRenderer({ block, cohortId, isStaff, requiresGithub, requiresSubmission = true, repositoryName, submissionsLocked = false, submissionsCloseAt, submissionWeekNumber, analyticsContext, lessonReturn, starterOpensNewTab = false, onProgressUpdate }: ContentBlockRendererProps) {
  const toast = useToast()
  const { user } = useAuthContext()
  const draftKey = submissionDraftKey({ userId: user?.id, cohortId, blockId: block.id })
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null)
  const submissions = block.submissions ?? []
  const latestSubmission = submissions[0] || null
  const hasRedoRequest = latestSubmission?.grade === 'R'
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
  const [knowledgeCheckDraft, setKnowledgeCheckDraft] = useState<{ blockId: number; value: NonNullable<ContentBlock['knowledge_check']> } | null>(null)
  const knowledgeCheck = knowledgeCheckDraft?.blockId === block.id ? knowledgeCheckDraft.value : block.knowledge_check || null
  const [selectedCheckOption, setSelectedCheckOption] = useState<number | null>(null)
  const [checkingAnswer, setCheckingAnswer] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [activeVideoSegment, setActiveVideoSegment] = useState<VideoSegment | null>(null)
  const [completedVideoSegment, setCompletedVideoSegment] = useState<VideoSegment | null>(null)
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const vimeoPlayerRef = useRef<Player | null>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)
  const s3VideoRef = useRef<VideoPlayerHandle>(null)
  const activeVideoSegmentRef = useRef<VideoSegment | null>(null)
  const pendingVideoSegmentRef = useRef<VideoSegment | null>(null)
  const isCompletedRef = useRef(isCompleted)
  const trackedFeedbackRef = useRef<number | null>(null)
  useEffect(() => { isCompletedRef.current = isCompleted }, [isCompleted])
  useEffect(() => {
    setIsCompleted(block.progress?.status === 'completed')
  }, [block.id, block.progress?.status])
  useEffect(() => {
    activeVideoSegmentRef.current = null
    pendingVideoSegmentRef.current = null
    setActiveVideoSegment(null)
    setCompletedVideoSegment(null)
  }, [block.id])

  useEffect(() => {
    if (!analyticsContext || !latestSubmission?.grade || trackedFeedbackRef.current === latestSubmission.id) return
    trackedFeedbackRef.current = latestSubmission.id
    captureProductEvent('feedback_viewed', {
      submission_id: latestSubmission.id,
      grade_state: latestSubmission.grade === 'R' ? 'redo' : 'passed',
      age_bucket: analyticsAgeBucket(latestSubmission.graded_at),
    })
  }, [analyticsContext, latestSubmission?.grade, latestSubmission?.graded_at, latestSubmission?.id])

  const isExerciseType = block.block_type === 'exercise' || block.block_type === 'code_challenge'
  // Checkpoints with an explicit reviewed submission type (the Python pilot's
  // weekly checkpoints) are graded work, exactly like an exercise.
  const isSubmissionCheckpoint = block.block_type === 'checkpoint' && !knowledgeCheck &&
    ['text_submission', 'repo_url_submission', 'repo_and_live_url_submission'].includes(block.submission_type || '')
  const isWorkBlock = isExerciseType || isSubmissionCheckpoint
  const detectedLang = detectLanguage(block.filename, block.metadata?.language)
  const runnerFallbackLanguage = codeRunnerLanguageFromEditor(detectedLang) || 'ruby'
  const runnerConfig = normalizeCodeRunnerConfig(block.submission_config, runnerFallbackLanguage)
  const submissionType = block.submission_type || (requiresSubmission ? (requiresGithub ? 'prework_github_sync' : 'text_submission') : 'manual_complete')
  const usesManualExerciseCompletion = isExerciseType && submissionType === 'manual_complete'
  const usesGithubSyncSubmission = isExerciseType && submissionType === 'prework_github_sync'
  const usesTextSubmission = isWorkBlock && submissionType === 'text_submission'
  const usesRepoArtifactSubmission = isWorkBlock && (submissionType === 'repo_url_submission' || submissionType === 'repo_and_live_url_submission')
  const requiresLiveUrl = submissionType === 'repo_and_live_url_submission'
  const workLocked = submissionsLocked && (isWorkBlock || (block.block_type === 'checkpoint' && !knowledgeCheck))
  const lessonReturnUrl = lessonReturn?.url
  const lessonReturnLabel = lessonReturn?.label
  // "Paste it here" only when this learner has an open text box to paste into.
  const starterHint = usesTextSubmission && !isStaff && !workLocked ? 'submit' : 'practice'
  const starterLinks = useMemo<StarterLinkContext | undefined>(
    () => (lessonReturnUrl ? { lessonReturn: { url: lessonReturnUrl, label: lessonReturnLabel }, hint: starterHint, newTab: starterOpensNewTab } : undefined),
    [lessonReturnUrl, lessonReturnLabel, starterHint, starterOpensNewTab],
  )
  const latestStatus = submissionStatus(latestSubmission)
  const lockCopy = submissionWeekNumber ? `Week ${submissionWeekNumber} submissions are closed` : 'Submissions are closed'
  const videoSegments = useMemo(() => normalizeVideoSegments(block.metadata), [block.metadata])
  const deepLinkedPosition = useMemo(() => {
    if (typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get('t')
    if (raw === null || raw.trim() === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }, [block.id])
  const initialVideoPosition = playbackStart(videoSegments, block.progress?.video_last_position || 0, deepLinkedPosition)

  const segmentForPlaybackPosition = useCallback((seconds: number) => {
    const pending = pendingVideoSegmentRef.current
    if (pending) {
      if (!isVideoSegmentSeekPosition(seconds, pending)) return null
      pendingVideoSegmentRef.current = null
      activeVideoSegmentRef.current = pending
      return pending
    }
    return activeVideoSegmentRef.current
  }, [])

  const finishActiveVideoSegment = useCallback(() => {
    const segment = activeVideoSegmentRef.current
    if (!segment) return
    activeVideoSegmentRef.current = null
    pendingVideoSegmentRef.current = null
    setActiveVideoSegment(null)
    setCompletedVideoSegment(segment)
  }, [])

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
  useEffect(() => () => {
    const pending = pendingDraftRef.current
    if (pending) writeSubmissionDraft(pending.key, pending.draft)
  }, [])
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

  const markVideoCompleted = useCallback(async () => {
    if (isStaff) return
    if (isCompletedRef.current) return
    const res = await api.updateProgress(block.id, 'completed', cohortId)
    if (!res.error) {
      setIsCompleted(true)
      if (analyticsContext) captureProductEvent('learning_step_completed', {
        module_id: analyticsContext.moduleId,
        lesson_id: analyticsContext.lessonId,
        content_block_id: block.id,
        block_type: block.block_type,
        source: 'video',
      })
      onProgressUpdate?.()
    }
  }, [analyticsContext, block.block_type, block.id, cohortId, isStaff, onProgressUpdate])

  // Vimeo completion tracking
  useEffect(() => {
    const isVideoBlock = block.block_type === 'video' || block.block_type === 'recording'
    if (!isVideoBlock || !block.video_url) return

    const vimeo = getVimeoEmbed(block.video_url)
    if (!vimeo || !vimeoContainerRef.current) return

    const vimeoUrl = (
      vimeo.hash
        ? `https://vimeo.com/${vimeo.id}/${vimeo.hash}`
        : `https://vimeo.com/${vimeo.id}`
    ) as VimeoUrl

    const player = new Player(vimeoContainerRef.current, {
      url: vimeoUrl as `https://vimeo.com/${string}`,
      width: 640,
      responsive: true,
    })
    vimeoPlayerRef.current = player

    player.on('ended', markVideoCompleted)
    player.on('timeupdate', ({ seconds }) => {
      const segment = segmentForPlaybackPosition(seconds)
      if (!segment || seconds < segment.end_seconds) return
      void player.pause().catch(() => undefined)
      finishActiveVideoSegment()
    })
    if (initialVideoPosition > 0) {
      void player.ready().then(() => player.setCurrentTime(initialVideoPosition)).catch(() => undefined)
    }

    return () => {
      vimeoPlayerRef.current = null
      player.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url, finishActiveVideoSegment, initialVideoPosition, markVideoCompleted, segmentForPlaybackPosition])

  // YouTube completion tracking via iframe API postMessage
  useEffect(() => {
    const isVideoBlock = block.block_type === 'video' || block.block_type === 'recording'
    if (!isVideoBlock || !block.video_url) return

    const ytId = getYouTubeId(block.video_url)
    if (!ytId) return

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return
      if (event.source !== ytIframeRef.current?.contentWindow) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.event === 'onStateChange' && data?.info === 0 && String(data?.id) === String(block.id)) {
          markVideoCompleted()
        }
        const currentTime = Number(data?.info?.currentTime)
        const segment = data?.event === 'infoDelivery' && Number.isFinite(currentTime) ? segmentForPlaybackPosition(currentTime) : null
        if (segment && currentTime >= segment.end_seconds) {
          ytIframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
            'https://www.youtube.com'
          )
          finishActiveVideoSegment()
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    window.addEventListener('message', handleMessage)

    const iframe = ytIframeRef.current
    const sendListenCommand = () => {
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: block.id }),
        'https://www.youtube.com'
      )
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }),
        'https://www.youtube.com'
      )
    }

    if (iframe) {
      iframe.addEventListener('load', sendListenCommand)
      if (iframe.contentWindow) sendListenCommand()
    }

    return () => {
      window.removeEventListener('message', handleMessage)
      if (iframe) {
        iframe.removeEventListener('load', sendListenCommand)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url, finishActiveVideoSegment, markVideoCompleted, segmentForPlaybackPosition])

  const blockIcons: Record<string, React.ReactNode> = {
    video: <Play className="h-4 w-4" />,
    text: <FileText className="h-4 w-4" />,
    exercise: <Code className="h-4 w-4" />,
    code_challenge: <Code className="h-4 w-4" />,
    checkpoint: <CheckCircle2 className="h-4 w-4" />,
    recording: <Play className="h-4 w-4" />,
  }

  const handleToggleComplete = async () => {
    if (isStaff) return
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
      toast.success(newStatus === 'completed' ? 'Marked complete' : 'Marked incomplete')
    } else {
      toast.error(res.error)
    }
  }

  const fetchBlockStreamUrl = useCallback(async () => {
    const res = await api.getContentBlockVideoStream(block.id, cohortId)
    return res.data?.stream_url || null
  }, [block.id, cohortId])

  const saveBlockProgress = useCallback((data: import('./VideoPlayer').VideoProgressData) => {
    api.updateContentBlockVideoProgress(block.id, data, cohortId).then(res => {
      if (res.data?.video_progress?.completed) {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    })
  }, [block.id, cohortId, onProgressUpdate])

  // Optimistic local-state flip on video end. We intentionally don't call
  // onProgressUpdate here because saveBlockProgress already does so when the
  // backend confirms completion in the same `ended` ping — calling it from
  // both paths fired the parent's progress refetch twice on every completion.
  const handleBlockCompleted = useCallback(() => {
    setIsCompleted(true)
  }, [])

  const handleVideoSegmentSelect = useCallback((segment: VideoSegment) => {
    const seconds = segment.start_seconds
    setActiveVideoSegment(segment)
    setCompletedVideoSegment(null)
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('t', String(seconds))
      window.history.replaceState(window.history.state, '', nextUrl)
    }

    if (block.s3_video_key) {
      pendingVideoSegmentRef.current = null
      activeVideoSegmentRef.current = segment
      s3VideoRef.current?.seekTo(seconds, true)
      return
    }
    if (block.video_url && getYouTubeId(block.video_url)) {
      activeVideoSegmentRef.current = null
      pendingVideoSegmentRef.current = segment
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        'https://www.youtube.com'
      )
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
        'https://www.youtube.com'
      )
      return
    }
    if (vimeoPlayerRef.current) {
      activeVideoSegmentRef.current = null
      pendingVideoSegmentRef.current = segment
      void vimeoPlayerRef.current.setCurrentTime(seconds).then(() => vimeoPlayerRef.current?.play()).catch(() => undefined)
    }
  }, [block.s3_video_key, block.video_url])

  const handleSubmit = async () => {
    if (isStaff) return

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
    const res = await api.createSubmission({
      content_block_id: block.id,
      cohort_id: cohortId,
      ...(usesTextSubmission ? { text: submissionText } : {}),
      ...(usesRepoArtifactSubmission ? {
        repo_url: repoUrl.trim(),
        pr_url: prUrl.trim() || undefined,
        live_url: liveUrl.trim() || undefined,
        branch: branchName.trim() || undefined,
        commit_sha: commitSha.trim() || undefined,
        notes: submissionNotes.trim() || undefined,
      } : {}),
    })
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
      setHasEditedSubmissionDraft(false)
      const savedSubmission = res.data?.submission
      const attempt = savedSubmission?.num_submissions || (latestSubmission?.num_submissions || 0) + 1
      captureProductEvent('submission_created', {
        content_block_id: block.id,
        submission_type: submissionType,
        attempt,
      })
      if (hasRedoRequest && latestSubmission) captureProductEvent('redo_submitted', {
        submission_id: savedSubmission?.id || latestSubmission.id,
        attempt,
        age_bucket: analyticsAgeBucket(latestSubmission.graded_at),
      })
      if (analyticsContext) captureProductEvent('learning_step_completed', {
        module_id: analyticsContext.moduleId,
        lesson_id: analyticsContext.lessonId,
        content_block_id: block.id,
        block_type: block.block_type,
        source: 'submission',
      })
      const message = latestSubmission
        ? 'Resubmitted. Your instructor will review it and reply here.'
        : 'Submitted. Your instructor will review it and reply here.'
      setSubmissionSuccess(message)
      toast.success(message)
      onProgressUpdate?.()
    }
    setIsSubmitting(false)
  }

  const handleKnowledgeCheck = async () => {
    if (!knowledgeCheck || selectedCheckOption === null) return
    setCheckingAnswer(true)
    setCheckError(null)
    if (knowledgeCheck.id < 0 && knowledgeCheck.correct_option !== undefined) {
      const correct = selectedCheckOption === knowledgeCheck.correct_option
      setKnowledgeCheckDraft({ blockId: block.id, value: {
        ...knowledgeCheck,
        attempt_count: knowledgeCheck.attempt_count + 1,
        latest_attempt: {
          id: -1,
          selected_option: selectedCheckOption,
          correct,
          correct_option: knowledgeCheck.correct_option,
          explanation: knowledgeCheck.explanation || '',
          created_at: new Date().toISOString(),
        },
      } })
      setCheckingAnswer(false)
      return
    }

    const response = await api.attemptKnowledgeCheck(knowledgeCheck.id, selectedCheckOption, cohortId)
    if (response.error || !response.data) {
      setCheckError(response.error || 'Could not check this answer.')
    } else {
      setKnowledgeCheckDraft({ blockId: block.id, value: response.data.knowledge_check })
      const result = response.data.knowledge_check.latest_attempt
      if (result) captureProductEvent('knowledge_check_attempted', {
        knowledge_check_id: response.data.knowledge_check.id,
        content_block_id: block.id,
        correct: result.correct,
        attempt: response.data.knowledge_check.attempt_count,
      })
      if (response.data.progress?.status === 'completed') {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    }
    setCheckingAnswer(false)
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info-200 bg-info-50 py-1 pl-3 pr-1 text-sm text-info-800">
          <p className="py-1.5">Restored your unsent draft from <span className="tabular-nums">{formatShortDateTime(restoredDraftAt, 'earlier')}</span>.</p>
          <Button variant="quiet" size="sm" onClick={discardDraft} className="text-info-800! hover:bg-info-100!">Discard draft</Button>
        </div>
      )}
      {submissionError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger-200 bg-danger-50 py-1 pl-3 pr-1 text-sm text-danger-700">
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
        <div className="rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700">{submissionSuccess}</div>
      )}
    </div>
  ) : null

  return (
    <div className="app-surface overflow-hidden">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-sunken/60 px-4 py-2">
        <div className="text-ink-muted">{blockIcons[block.block_type]}</div>
        <span className="text-sm font-semibold capitalize text-ink">{block.block_type.replace('_', ' ')}</span>
        {block.title && <span className="min-w-0 text-sm text-ink-muted [overflow-wrap:anywhere]">· {block.title}</span>}
        {latestStatus && <StatusBadge status={latestStatus} />}
        {workLocked && (
          <StatusBadge status="closed" />
        )}
        <div className="ml-auto">
          {isStaff ? (
            <span className="text-xs font-semibold text-ink-muted">Preview</span>
          ) : usesManualExerciseCompletion ? (
            <button
              onClick={handleToggleComplete}
              disabled={workLocked && !isCompleted}
              className="pressable -my-1 flex h-11 w-11 items-center justify-center rounded-lg hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isCompleted ? 'Mark exercise not done' : 'Mark exercise complete'}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              )}
            </button>
          ) : isWorkBlock ? null : knowledgeCheck ? (
            isCompleted || knowledgeCheck.latest_attempt?.correct
              ? <span role="img" aria-label="Check complete"><CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden="true" /></span>
              : <span role="img" aria-label="Check not answered yet"><Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" /></span>
          ) : (
            <button
              type="button"
              onClick={handleToggleComplete}
              disabled={workLocked && !isCompleted}
              aria-pressed={isCompleted}
              className="pressable -my-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-ink-secondary hover:bg-slate-200/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              )}
              {isCompleted ? 'Done' : 'Mark done'}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {(block.block_type === 'video' || block.block_type === 'recording') && block.s3_video_key && (
          <VideoPlayer
            ref={s3VideoRef}
            key={`s3-${block.id}`}
            title={block.title || 'Video'}
            initialPosition={initialVideoPosition}
            initialTotalWatched={block.progress?.video_total_watched || 0}
            fetchStreamUrl={fetchBlockStreamUrl}
            onSaveProgress={saveBlockProgress}
            onCompleted={handleBlockCompleted}
            stopAtSeconds={activeVideoSegment?.end_seconds ?? null}
            onStopAtReached={finishActiveVideoSegment}
            trackProgress={!isStaff}
          />
        )}

        {block.block_type === 'video' && block.video_url && !block.s3_video_key && (
          <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
            {(() => {
              const ytId = getYouTubeId(block.video_url!)
              if (ytId) {
                return (
                  <iframe
                    ref={ytIframeRef}
                    src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${typeof window === 'undefined' ? '' : window.location.origin}&start=${initialVideoPosition}`}
                    className="w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                )
              }
              const vimeo = getVimeoEmbed(block.video_url!)
              if (vimeo) {
                return <div ref={vimeoContainerRef} className="w-full h-full" />
              }
              return (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <a href={sanitizeUrl(block.video_url!)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-white underline underline-offset-4">
                    Open video
                  </a>
                </div>
              )
            })()}
          </div>
        )}

        {block.block_type === 'recording' && block.video_url && !block.s3_video_key && (
          <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
            {(() => {
              const ytId = getYouTubeId(block.video_url!)
              if (ytId) {
                return (
                  <iframe
                    ref={ytIframeRef}
                    src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${typeof window === 'undefined' ? '' : window.location.origin}&start=${initialVideoPosition}`}
                    className="w-full h-full"
                    allowFullScreen
                  />
                )
              }
              const vimeo = getVimeoEmbed(block.video_url!)
              if (vimeo) {
                return <div ref={vimeoContainerRef} className="w-full h-full" />
              }
              return null
            })()}
          </div>
        )}

        {(block.block_type === 'video' || block.block_type === 'recording') && (
          <VideoSegmentControls segments={videoSegments} activeSegment={activeVideoSegment} completedSegment={completedVideoSegment} onSelect={handleVideoSegmentSelect} />
        )}

        {block.body && (
          <div className={block.block_type === 'video' ? 'mt-4' : ''}>
            <MarkdownRenderer content={block.body} starterLinks={starterLinks} />
          </div>
        )}

        {knowledgeCheck && (
          <section className="rounded-2xl border border-line bg-surface-sunken/60 p-4" aria-label="Quick retrieval check">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-ink-muted">Quick recall</p>
              {knowledgeCheck.objective_code && <span className="rounded-full border border-line bg-surface-raised px-2 py-0.5 font-mono text-xs font-semibold text-ink-secondary">{knowledgeCheck.objective_code}</span>}
            </div>
            <p className="mt-2 text-base font-semibold leading-6 text-ink">{knowledgeCheck.prompt}</p>
            <div className="mt-4 grid gap-2">
              {knowledgeCheck.options.map((option, index) => {
                const result = knowledgeCheck.latest_attempt
                const isCorrectAnswer = result && index === result.correct_option
                const wasIncorrectChoice = result && !result.correct && index === result.selected_option
                return <button key={`${index}:${option}`} type="button" disabled={Boolean(isStaff || result?.correct)} onClick={() => { setSelectedCheckOption(index); setCheckError(null) }} aria-pressed={selectedCheckOption === index} className={`pressable min-h-11 rounded-xl border px-4 py-2.5 text-left text-sm font-medium ${isCorrectAnswer ? 'border-success-300 bg-success-50 text-success-800' : wasIncorrectChoice ? 'border-warning-300 bg-warning-50 text-warning-800' : selectedCheckOption === index ? 'border-ruby-600 bg-surface-raised text-ink ring-1 ring-ruby-600' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'} disabled:cursor-default`}>{option}</button>
              })}
            </div>
            {isStaff && knowledgeCheck.correct_option !== undefined ? <div className="mt-4 rounded-xl border border-line bg-surface-raised p-3 text-sm text-ink-secondary"><p className="font-semibold text-ink">Answer: {knowledgeCheck.options[knowledgeCheck.correct_option]}</p><p className="mt-1 leading-6">{knowledgeCheck.explanation}</p></div> : knowledgeCheck.latest_attempt ? <div aria-live="polite" className={`mt-4 rounded-xl border p-3 ${knowledgeCheck.latest_attempt.correct ? 'border-success-200 bg-success-50' : 'border-warning-200 bg-warning-50'}`}><p className={`text-sm font-semibold ${knowledgeCheck.latest_attempt.correct ? 'text-success-800' : 'text-warning-800'}`}>{knowledgeCheck.latest_attempt.correct ? 'Correct — this check is complete.' : 'Not yet — review the explanation and try again.'}</p><p className="mt-1 text-sm leading-6 text-ink-secondary">{knowledgeCheck.latest_attempt.explanation}</p></div> : null}
            {!isStaff && !knowledgeCheck.latest_attempt?.correct && <Button disabled={selectedCheckOption === null || checkingAnswer} onClick={() => void handleKnowledgeCheck()} className="mt-4">{checkingAnswer ? 'Checking…' : knowledgeCheck.latest_attempt ? 'Try this answer' : 'Check answer'}</Button>}
            {checkError && <p className="mt-2 text-sm font-semibold text-danger-700" role="alert">{checkError}</p>}
            {knowledgeCheck.attempt_count > 0 && <p className="mt-2 text-xs tabular-nums text-ink-muted">{knowledgeCheck.attempt_count} {knowledgeCheck.attempt_count === 1 ? 'attempt' : 'attempts'} recorded</p>}
          </section>
        )}

        {block.filename && (
          <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-ink-secondary [overflow-wrap:anywhere]">
            <Code className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono">{block.filename}</span>
          </div>
        )}

        {!isStaff && usesManualExerciseCompletion && (
          <div className={`mt-4 rounded-xl border px-4 py-3 ${isCompleted ? 'border-success-200 bg-success-50' : 'border-line bg-surface-sunken/60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${isCompleted ? 'text-success-800' : 'text-ink'}`}>
                  {isCompleted ? 'Exercise marked complete' : 'Mark this exercise complete when you finish it'}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Use this for practice blocks that do not require a submission.
                </p>
              </div>
              <Button
                variant={isCompleted ? 'secondary' : 'primary'}
                onClick={handleToggleComplete}
                disabled={workLocked && !isCompleted}
              >
                {isCompleted ? (
                  <>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Mark not done
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Mark complete
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {!isStaff && isWorkBlock && submissionType !== 'manual_complete' && (
          <div className="mt-4 space-y-3">
            {workLocked && (
              <div className="rounded-xl border border-line bg-surface-sunken/60 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-ink">{lockCopy}</p>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      Closed {formatShortDateTime(submissionsCloseAt, 'the close time')}. Existing submissions and feedback remain visible, but new submissions and redo resubmissions are disabled.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {latestSubmission?.grade && (
              /* One card for the latest review: the feedback lives inside it; the status badge is in the block header. */
              <section
                aria-label={hasRedoRequest ? 'Instructor feedback: redo requested' : 'Instructor feedback'}
                className={`rounded-xl border px-4 py-3 ${hasRedoRequest ? 'border-warning-200 bg-warning-50' : 'border-success-200 bg-success-50'}`}
              >
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${hasRedoRequest ? 'text-warning-800' : 'text-success-800'}`}>
                  {hasRedoRequest ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {hasRedoRequest ? 'Your instructor asked for a redo. Read the feedback, then resubmit below.' : `Reviewed by your instructor${GRADE_LABELS[latestSubmission.grade] ? ` · ${latestSubmission.grade} (${GRADE_LABELS[latestSubmission.grade]})` : ''}`}
                </p>
                {latestSubmission.feedback ? (
                  <FeedbackBody feedback={latestSubmission.feedback} className="mt-2 text-ink" />
                ) : hasRedoRequest ? (
                  <p className="mt-1 text-sm text-ink-secondary">Review the instructions and try again. Message your instructor if you are not sure what to change.</p>
                ) : null}
              </section>
            )}
            {latestStatus === 'awaiting_review' && (
              <div className="flex items-start gap-2 rounded-xl border border-pending-200 bg-pending-50 px-4 py-3 text-sm text-pending-700" role="status">
                <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p><span className="font-semibold">Submitted · awaiting review.</span> Your instructor will reply here. You can still revise and resubmit before they review it.</p>
              </div>
            )}
            {block.submissions && block.submissions.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-ink">
                  {block.submissions.length === 1 ? 'Your submission' : <>Your submissions <span className="font-normal tabular-nums text-ink-muted">({block.submissions.length})</span></>}
                </h3>
                {block.submissions.map((sub, idx) => {
                  const isLatest = idx === 0
                  const isRedo = sub.grade === 'R'
                  const isGraded = sub.grade !== null
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-xl border border-line p-4 ${isLatest ? 'bg-surface-raised' : 'bg-surface-sunken/60'}`}
                    >
                      <p className="mb-3 text-xs text-ink-muted">
                        <span className="font-semibold text-ink-secondary tabular-nums">Submission #{sub.num_submissions}</span>
                        {' · '}<span className="tabular-nums">{new Date(sub.created_at).toLocaleDateString()}</span>
                        {' · '}{isLatest ? 'Latest' : 'Earlier'}
                        {isGraded && <>{' · '}{isRedo ? 'Redo requested' : `Grade ${sub.grade}`}</>}
                      </p>

                      <div className="mt-2">
                        {sub.text ? (
                          <CodeEditor
                            value={sub.text}
                            language={detectedLang}
                            readOnly
                            minHeight={120}
                          />
                        ) : (
                          <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
                            No inline code text submitted.
                          </div>
                        )}
                      </div>

                      {submissionArtifacts(sub)}

                      {/* The latest feedback is shown once, in the card above. */}
                      {!isLatest && isGraded && (sub.feedback || isRedo) && (
                        <div className="mt-3 rounded-lg border border-line bg-surface-raised p-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-ink-secondary">
                              {isRedo ? 'Earlier feedback · redo requested' : 'Earlier feedback'}
                            </p>
                            {sub.graded_at && (
                              <p className="text-xs tabular-nums text-ink-muted">
                                {new Date(sub.graded_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          {sub.feedback ? (
                            <FeedbackBody feedback={sub.feedback} />
                          ) : (
                            <p className="text-sm italic text-ink-muted">No written feedback.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {usesGithubSyncSubmission ? (
              <div className="space-y-2 rounded-xl border border-line bg-surface-sunken/60 p-4">
                <p className="text-sm font-semibold text-ink">Submit via GitHub</p>
                <p className="text-sm text-ink-secondary">
                  Complete this exercise in your local environment{block.filename ? ` in the file ${block.filename}` : ''}, then push your changes to your{' '}
                  <span className="font-semibold text-ink">{repositoryName || 'exercises'}</span> repository on GitHub.
                </p>
                <p className="text-sm text-ink-muted">
                  {workLocked ? 'GitHub sync is disabled after the submission window closes.' : 'Your instructor will sync and review your code from GitHub.'}
                </p>
              </div>
            ) : usesTextSubmission ? (
              <div className="space-y-3 rounded-xl border border-line bg-surface-sunken/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {hasRedoRequest ? 'Revise and resubmit' : block.submissions && block.submissions.length > 0 ? 'Revise your answer' : 'Write your solution'}
                  </h3>
                  {block.filename && (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-slate-200/60 px-2 py-1 font-mono text-xs text-ink-secondary [overflow-wrap:anywhere]">
                      <Code className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {block.filename}
                    </span>
                  )}
                </div>
                <CodeEditor
                  value={submissionText}
                  onChange={(value) => handleDraftChange(() => setSubmissionText(value))}
                  language={detectedLang}
                  minHeight={240}
                  readOnly={workLocked}
                  // Freeze the draft while it is being sent so a later edit can't be dropped on success.
                  busy={isSubmitting}
                  showKeyboardHelp
                />
                {runnerConfig.enabled && (
                  <CodeRunner
                    code={submissionText}
                    language={runnerConfig.language}
                    timeoutMs={CODE_RUNNER_TIMEOUT_MS}
                  />
                )}
                {submissionStatusMessage}
                <div className="flex items-center justify-end">
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={workLocked || isSubmitting || !submissionText.trim()}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {workLocked ? 'Closed' : isSubmitting ? 'Submitting…' : latestSubmission ? (isSubmissionCheckpoint ? 'Resubmit checkpoint' : 'Resubmit') : (isSubmissionCheckpoint ? 'Submit checkpoint' : 'Submit')}
                  </Button>
                </div>
              </div>
            ) : usesRepoArtifactSubmission ? (
              <div className="space-y-3 rounded-xl border border-line bg-surface-sunken/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {hasRedoRequest ? 'Revise and resubmit' : latestSubmission ? 'Update submission' : 'Submit project'}
                  </h3>
                  <span className="text-xs text-ink-muted">
                    {requiresLiveUrl ? 'Repo + live URL required' : 'Repository URL required'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-ink-secondary">Repository URL</span>
                    <input
                      value={repoUrl}
                      onChange={(e) => handleDraftChange(() => setRepoUrl(e.target.value))}
                      disabled={workLocked || isSubmitting}
                      placeholder="https://github.com/username/project"
                      className="app-control w-full"
                    />
                  </label>
                  {requiresLiveUrl && (
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-ink-secondary">Live URL</span>
                      <input
                        value={liveUrl}
                        onChange={(e) => handleDraftChange(() => setLiveUrl(e.target.value))}
                        disabled={workLocked || isSubmitting}
                        placeholder="https://your-app.example.com"
                        className="app-control w-full"
                      />
                    </label>
                  )}
                </div>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-secondary">Notes (optional)</span>
                  <textarea
                    value={submissionNotes}
                    onChange={(e) => handleDraftChange(() => setSubmissionNotes(e.target.value))}
                    disabled={workLocked || isSubmitting}
                    rows={4}
                    placeholder="Anything your instructor should know about this submission."
                    className="app-control w-full"
                  />
                </label>
                <div className="space-y-3">
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-expanded={showAdvancedRepoFields}
                    onClick={() => setShowAdvancedRepoFields((current) => !current)}
                    className="-ml-2"
                  >
                    {showAdvancedRepoFields ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {showAdvancedRepoFields ? 'Hide extra Git details' : 'Add PR / branch / commit details'}
                  </Button>
                  {showAdvancedRepoFields && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {!requiresLiveUrl && (
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-ink-secondary">Live URL (optional)</span>
                          <input
                            value={liveUrl}
                            onChange={(e) => handleDraftChange(() => setLiveUrl(e.target.value))}
                            disabled={workLocked || isSubmitting}
                            placeholder="https://your-app.example.com"
                            className="app-control w-full"
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Pull Request URL (optional)</span>
                        <input
                          value={prUrl}
                          onChange={(e) => handleDraftChange(() => setPrUrl(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="https://github.com/.../pull/123"
                          className="app-control w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Branch (optional)</span>
                        <input
                          value={branchName}
                          onChange={(e) => handleDraftChange(() => setBranchName(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="main"
                          className="app-control w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Commit SHA (optional)</span>
                        <input
                          value={commitSha}
                          onChange={(e) => handleDraftChange(() => setCommitSha(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="abc1234"
                          className="app-control w-full"
                        />
                      </label>
                    </div>
                  )}
                </div>
                {submissionStatusMessage}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-muted">
                    {requiresLiveUrl
                      ? 'Share the repo and deployed app you want reviewed.'
                      : 'Share the repo you want reviewed. Notes are optional.'}
                  </p>
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={workLocked || isSubmitting || !repoUrl.trim() || (requiresLiveUrl && !liveUrl.trim())}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {workLocked ? 'Closed' : isSubmitting ? 'Submitting…' : 'Submit links'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {isStaff && block.solution && (
          <div className="mt-4">
            <Button variant="quiet" size="sm" aria-expanded={showSolution} onClick={() => setShowSolution(!showSolution)} className="-ml-2">
              {showSolution ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              Solution
            </Button>
            {showSolution && (
              <div className="mt-2">
                <CodeEditor
                  value={block.solution}
                  language={detectedLang}
                  readOnly
                  minHeight={120}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
