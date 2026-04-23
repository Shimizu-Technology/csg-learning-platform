import { useState, useRef, useEffect, useCallback } from 'react'
import Player, { type VimeoUrl } from '@vimeo/player'
import { Play, FileText, Code, CheckCircle2, Circle, ChevronDown, ChevronUp, Send, BadgeCheck, RotateCcw, ExternalLink, Globe, GitBranch } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { GradeDisplay } from './GradeDisplay'
import { CodeEditor, detectLanguage } from './CodeEditor'
import { VideoPlayer } from './VideoPlayer'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'

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

interface ContentBlockRendererProps {
  block: ContentBlock
  isStaff?: boolean
  requiresGithub?: boolean
  requiresSubmission?: boolean
  repositoryName?: string
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

export function ContentBlockRenderer({ block, isStaff, requiresGithub, requiresSubmission = true, repositoryName, onProgressUpdate }: ContentBlockRendererProps) {
  const submissions = block.submissions ?? []
  const latestSubmission = submissions[0] || null
  const hasRedoRequest = latestSubmission?.grade === 'R'
  const hasPassingGrade = submissions.some((s) => s.grade !== null && s.grade !== 'R')
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
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)
  const isCompletedRef = useRef(isCompleted)
  useEffect(() => { isCompletedRef.current = isCompleted }, [isCompleted])
  useEffect(() => {
    setIsCompleted(block.progress?.status === 'completed')
  }, [block.id, block.progress?.status])

  const isExerciseType = block.block_type === 'exercise' || block.block_type === 'code_challenge'
  const detectedLang = detectLanguage(block.filename, block.metadata?.language)
  const submissionType = block.submission_type || (requiresSubmission ? (requiresGithub ? 'prework_github_sync' : 'text_submission') : 'manual_complete')
  const usesManualExerciseCompletion = isExerciseType && submissionType === 'manual_complete'
  const usesGithubSyncSubmission = isExerciseType && submissionType === 'prework_github_sync'
  const usesTextSubmission = isExerciseType && submissionType === 'text_submission'
  const usesRepoArtifactSubmission = isExerciseType && (submissionType === 'repo_url_submission' || submissionType === 'repo_and_live_url_submission')
  const requiresLiveUrl = submissionType === 'repo_and_live_url_submission'
  const hasUngradedSubmission = submissions.length > 0 && !hasRedoRequest && !hasPassingGrade

  const markVideoCompleted = useCallback(async () => {
    if (isCompletedRef.current) return
    const res = await api.updateProgress(block.id, 'completed')
    if (!res.error) {
      setIsCompleted(true)
      onProgressUpdate?.()
    }
  }, [block.id, onProgressUpdate])

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

    player.on('ended', markVideoCompleted)

    return () => {
      player.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url, markVideoCompleted])

  // YouTube completion tracking via iframe API postMessage
  useEffect(() => {
    const isVideoBlock = block.block_type === 'video' || block.block_type === 'recording'
    if (!isVideoBlock || !block.video_url) return

    const ytId = getYouTubeId(block.video_url)
    if (!ytId) return

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.event === 'onStateChange' && data?.info === 0 && String(data?.id) === String(block.id)) {
          markVideoCompleted()
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
  }, [block.id, block.block_type, block.video_url, markVideoCompleted])

  const blockIcons: Record<string, React.ReactNode> = {
    video: <Play className="h-4 w-4" />,
    text: <FileText className="h-4 w-4" />,
    exercise: <Code className="h-4 w-4" />,
    code_challenge: <Code className="h-4 w-4" />,
    checkpoint: <CheckCircle2 className="h-4 w-4" />,
    recording: <Play className="h-4 w-4" />,
  }

  const handleToggleComplete = async () => {
    const newStatus = isCompleted ? 'not_started' : 'completed'
    const res = await api.updateProgress(block.id, newStatus)
    if (!res.error) {
      setIsCompleted(!isCompleted)
      onProgressUpdate?.()
    }
  }

  const fetchBlockStreamUrl = useCallback(async () => {
    const res = await api.getContentBlockVideoStream(block.id)
    return res.data?.stream_url || null
  }, [block.id])

  const saveBlockProgress = useCallback((data: import('./VideoPlayer').VideoProgressData) => {
    api.updateContentBlockVideoProgress(block.id, data).then(res => {
      if (res.data?.video_progress?.completed) {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    })
  }, [block.id, onProgressUpdate])

  // Optimistic local-state flip on video end. We intentionally don't call
  // onProgressUpdate here because saveBlockProgress already does so when the
  // backend confirms completion in the same `ended` ping — calling it from
  // both paths fired the parent's progress refetch twice on every completion.
  const handleBlockCompleted = useCallback(() => {
    setIsCompleted(true)
  }, [])

  const handleSubmit = async () => {
    if (usesTextSubmission && !submissionText.trim()) return
    if (usesRepoArtifactSubmission && !repoUrl.trim()) return
    if (requiresLiveUrl && !liveUrl.trim()) return
    setIsSubmitting(true)
    const res = await api.createSubmission({
      content_block_id: block.id,
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
    if (!res.error) {
      setSubmissionText('')
      setRepoUrl('')
      setPrUrl('')
      setLiveUrl('')
      setBranchName('')
      setCommitSha('')
      setSubmissionNotes('')
      setShowAdvancedRepoFields(false)
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
              <a href={sanitizeUrl(sub.github_code_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-primary-200 hover:text-primary-600">
                <Code className="h-3 w-3" />
                GitHub Code
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.repo_url && (
              <a href={sanitizeUrl(sub.repo_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-primary-200 hover:text-primary-600">
                <Code className="h-3 w-3" />
                Repo
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.pr_url && (
              <a href={sanitizeUrl(sub.pr_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-primary-200 hover:text-primary-600">
                <GitBranch className="h-3 w-3" />
                PR
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {sub.live_url && (
              <a href={sanitizeUrl(sub.live_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-primary-200 hover:text-primary-600">
                <Globe className="h-3 w-3" />
                Live
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
        {(sub.branch || sub.commit_sha || sub.notes) && (
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
            {sub.branch && <p><span className="font-medium text-slate-700">Branch:</span> {sub.branch}</p>}
            {sub.commit_sha && <p><span className="font-medium text-slate-700">Commit:</span> <span className="font-mono">{sub.commit_sha}</span></p>}
            {sub.notes && <p className="whitespace-pre-wrap"><span className="font-medium text-slate-700">Notes:</span> {sub.notes}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="text-slate-500">{blockIcons[block.block_type]}</div>
        <span className="text-sm font-medium text-slate-700 capitalize">{block.block_type.replace('_', ' ')}</span>
        {block.title && <span className="text-sm text-slate-500">· {block.title}</span>}
        {hasRedoRequest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-xs font-medium text-orange-700">
            <RotateCcw className="h-3.5 w-3.5" />
            Redo Requested
          </span>
        )}
        {!hasRedoRequest && hasPassingGrade && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-200 px-2 py-0.5 text-xs font-medium text-success-700">
            <BadgeCheck className="h-3.5 w-3.5" />
            Graded
          </span>
        )}
        {hasUngradedSubmission && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700">
            <Send className="h-3.5 w-3.5" />
            Submitted
          </span>
        )}
        <div className="ml-auto">
          {usesManualExerciseCompletion ? (
            <button
              onClick={handleToggleComplete}
              className="flex items-center gap-1.5 text-sm transition-colors"
              aria-label={isCompleted ? 'Mark exercise not done' : 'Mark exercise complete'}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-500" />
              ) : (
                <Circle className="h-5 w-5 text-slate-300 hover:text-slate-400" />
              )}
            </button>
          ) : isExerciseType ? (
            hasPassingGrade ? (
              <CheckCircle2 className="h-5 w-5 text-success-500" />
            ) : hasRedoRequest ? (
              <RotateCcw className="h-4 w-4 text-orange-500" />
            ) : submissions.length > 0 ? (
              <Circle className="h-5 w-5 text-amber-400" />
            ) : (
              <Circle className="h-5 w-5 text-slate-200" />
            )
          ) : (
            <button
              onClick={handleToggleComplete}
              className="flex items-center gap-1.5 text-sm transition-colors"
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-500" />
              ) : (
                <Circle className="h-5 w-5 text-slate-300 hover:text-slate-400" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {(block.block_type === 'video' || block.block_type === 'recording') && block.s3_video_key && (
          <VideoPlayer
            key={`s3-${block.id}`}
            title={block.title || 'Video'}
            initialPosition={block.progress?.video_last_position || 0}
            initialTotalWatched={block.progress?.video_total_watched || 0}
            fetchStreamUrl={fetchBlockStreamUrl}
            onSaveProgress={saveBlockProgress}
            onCompleted={handleBlockCompleted}
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
                    src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${window.location.origin}`}
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
                  <a href={sanitizeUrl(block.video_url!)} target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline">
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
                    src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${window.location.origin}`}
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

        {block.body && (
          <div className={block.block_type === 'video' ? 'mt-4' : ''}>
            <MarkdownRenderer content={block.body} />
          </div>
        )}

        {block.filename && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
            <Code className="h-3.5 w-3.5" />
            <span className="font-mono">{block.filename}</span>
          </div>
        )}

        {usesManualExerciseCompletion && (
          <div className={`mt-4 rounded-xl border px-4 py-3 ${isCompleted ? 'border-success-200 bg-success-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {isCompleted ? 'Exercise marked complete' : 'Mark this exercise complete when you finish it'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Use this for practice blocks that do not require a submission.
                </p>
              </div>
              <button
                onClick={handleToggleComplete}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isCompleted
                    ? 'border border-success-200 bg-white text-success-700 hover:bg-success-50'
                    : 'bg-primary-500 text-white hover:bg-primary-600'
                }`}
              >
                {isCompleted ? (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    Mark Not Done
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Mark Complete
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {(block.block_type === 'exercise' || block.block_type === 'code_challenge') && submissionType !== 'manual_complete' && (
          <div className="mt-4 space-y-3">
            {latestSubmission?.grade && (
              <div className={`rounded-xl border px-4 py-3 ${
                hasRedoRequest ? 'border-orange-200 bg-orange-50' : 'border-success-200 bg-success-50'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${
                      hasRedoRequest ? 'text-orange-700' : 'text-success-700'
                    }`}>
                      {hasRedoRequest ? 'Redo requested — please review and resubmit' : 'Latest submission graded'}
                    </p>
                    {latestSubmission.feedback && (
                      <div className={`mt-2 rounded-lg border p-3 ${
                        hasRedoRequest ? 'border-orange-200 bg-white' : 'border-success-200 bg-white'
                      }`}>
                        <p className="text-sm text-slate-800 whitespace-pre-wrap">{latestSubmission.feedback}</p>
                      </div>
                    )}
                  </div>
                  <GradeDisplay grade={latestSubmission.grade} size="md" />
                </div>
              </div>
            )}
            {block.submissions && block.submissions.length > 0 && (
              <div className="space-y-3">
                {block.submissions.map((sub, idx) => {
                  const isLatest = idx === 0
                  const isRedo = sub.grade === 'R'
                  const isGraded = sub.grade !== null
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-xl border p-4 ${
                        isLatest && isRedo
                          ? 'border-orange-200 bg-orange-50'
                          : isLatest && isGraded
                          ? 'border-success-200 bg-success-50'
                          : isLatest
                          ? 'border-primary-200 bg-primary-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-medium text-slate-500">
                          Submission #{sub.num_submissions}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(sub.created_at).toLocaleDateString()}
                        </span>
                        {isLatest && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            isRedo
                              ? 'text-orange-700 bg-orange-100'
                              : isGraded
                              ? 'text-green-700 bg-green-100'
                              : 'text-primary-600 bg-primary-100'
                          }`}>
                            Latest
                          </span>
                        )}
                        {!isLatest && (
                          <span className="text-xs font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                            Previous
                          </span>
                        )}
                        {isGraded && <GradeDisplay grade={sub.grade} size="md" />}
                      </div>

                      <div className="mt-2">
                        {sub.text ? (
                          <CodeEditor
                            value={sub.text}
                            language={detectedLang}
                            readOnly
                            minHeight={120}
                          />
                        ) : (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                            No inline code text submitted.
                          </div>
                        )}
                      </div>

                      {submissionArtifacts(sub)}

                      {isGraded && (sub.feedback || isRedo) && (
                        <div className={`mt-3 rounded-lg border bg-white p-3 ${isRedo ? 'border-orange-200' : 'border-success-200'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <p className={`text-xs font-semibold ${isRedo ? 'text-orange-700' : 'text-success-700'}`}>
                              {isRedo ? 'Instructor Feedback — Redo' : 'Instructor Feedback'}
                            </p>
                            {sub.graded_at && (
                              <p className="text-xs text-slate-400">
                                {new Date(sub.graded_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          {sub.feedback ? (
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{sub.feedback}</p>
                          ) : isRedo ? (
                            <p className="text-xs text-slate-400 italic">Please review the exercise instructions and try again.</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {usesGithubSyncSubmission ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <p className="text-sm font-medium text-slate-700">Submit via GitHub</p>
                <p className="text-sm text-slate-500">
                  Complete this exercise in your local environment{block.filename ? ` in the file ${block.filename}` : ''}, then push your changes to your{' '}
                  <span className="font-semibold text-slate-700">{repositoryName || 'exercises'}</span> repository on GitHub.
                </p>
                <p className="text-xs text-slate-400">
                  Your instructor will sync and review your code from GitHub.
                </p>
              </div>
            ) : usesTextSubmission ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {hasRedoRequest ? 'Revise and resubmit' : block.submissions && block.submissions.length > 0 ? 'Revise your answer' : 'Write your solution'}
                  </p>
                  {block.filename && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 font-mono">
                      <Code className="h-3 w-3" />
                      {block.filename}
                    </span>
                  )}
                </div>
                <CodeEditor
                  value={submissionText}
                  onChange={setSubmissionText}
                  language={detectedLang}
                  minHeight={240}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {detectedLang.charAt(0).toUpperCase() + detectedLang.slice(1)}
                    {' · '}Tab = 2 spaces
                  </p>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !submissionText.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="h-4 w-4" />
                    {isSubmitting ? 'Submitting…' : 'Submit'}
                  </button>
                </div>
              </div>
            ) : usesRepoArtifactSubmission ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {hasRedoRequest ? 'Revise and resubmit' : latestSubmission ? 'Update submission' : 'Submit project'}
                  </p>
                  <span className="text-xs text-slate-400">
                    {requiresLiveUrl ? 'Repo + live URL required' : 'Repository URL required'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Repository URL</span>
                    <input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/username/project"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </label>
                  {requiresLiveUrl && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Live URL</span>
                      <input
                        value={liveUrl}
                        onChange={(e) => setLiveUrl(e.target.value)}
                        placeholder="https://your-app.example.com"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </label>
                  )}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</span>
                  <textarea
                    value={submissionNotes}
                    onChange={(e) => setSubmissionNotes(e.target.value)}
                    rows={4}
                    placeholder="Anything your instructor should know about this submission."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </label>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedRepoFields((current) => !current)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    {showAdvancedRepoFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {showAdvancedRepoFields ? 'Hide extra Git details' : 'Add PR / branch / commit details'}
                  </button>
                  {showAdvancedRepoFields && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {!requiresLiveUrl && (
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-600">Live URL (optional)</span>
                          <input
                            value={liveUrl}
                            onChange={(e) => setLiveUrl(e.target.value)}
                            placeholder="https://your-app.example.com"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Pull Request URL (optional)</span>
                        <input
                          value={prUrl}
                          onChange={(e) => setPrUrl(e.target.value)}
                          placeholder="https://github.com/.../pull/123"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Branch (optional)</span>
                        <input
                          value={branchName}
                          onChange={(e) => setBranchName(e.target.value)}
                          placeholder="main"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Commit SHA (optional)</span>
                        <input
                          value={commitSha}
                          onChange={(e) => setCommitSha(e.target.value)}
                          placeholder="abc1234"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {requiresLiveUrl
                      ? 'Share the repo and deployed app you want reviewed.'
                      : 'Share the repo you want reviewed. Notes are optional.'}
                  </p>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !repoUrl.trim() || (requiresLiveUrl && !liveUrl.trim())}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="h-4 w-4" />
                    {isSubmitting ? 'Submitting…' : 'Submit Links'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {isStaff && block.solution && (
          <div className="mt-4">
            <button
              onClick={() => setShowSolution(!showSolution)}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
              {showSolution ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Solution
            </button>
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
