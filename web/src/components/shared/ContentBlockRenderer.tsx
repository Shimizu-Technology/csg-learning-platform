import { useState, useRef, useEffect } from 'react'
import Player, { type VimeoUrl } from '@vimeo/player'
import { Play, FileText, Code, CheckCircle2, Circle, ChevronDown, ChevronUp, Send, BadgeCheck } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { GradeDisplay } from './GradeDisplay'
import { CodeEditor, detectLanguage } from './CodeEditor'
import { api } from '../../lib/api'

interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  solution?: string | null
  metadata: Record<string, any>
  progress?: { status: string; completed_at: string | null }
  submissions?: Array<{
    id: number
    text: string
    grade: string | null
    feedback: string | null
    graded_at: string | null
    num_submissions: number
    created_at: string
  }>
}

interface ContentBlockRendererProps {
  block: ContentBlock
  isStaff?: boolean
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

export function ContentBlockRenderer({ block, isStaff, onProgressUpdate }: ContentBlockRendererProps) {
  const hasGradedSubmission = (block.submissions ?? []).some((s) => s.grade !== null)
  const [isCompleted, setIsCompleted] = useState(block.progress?.status === 'completed')
  const [showSolution, setShowSolution] = useState(false)
  const [submissionText, setSubmissionText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const isCompletedRef = useRef(isCompleted)
  useEffect(() => { isCompletedRef.current = isCompleted }, [isCompleted])

  const detectedLang = detectLanguage(block.filename, block.metadata?.language)

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

    player.on('ended', async () => {
      if (isCompletedRef.current) return
      const res = await api.updateProgress(block.id, 'completed')
      if (!res.error) {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    })

    return () => {
      player.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url])

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

  const handleSubmit = async () => {
    if (!submissionText.trim()) return
    setIsSubmitting(true)
    const res = await api.createSubmission({
      content_block_id: block.id,
      text: submissionText,
    })
    if (!res.error) {
      setSubmissionText('')
      onProgressUpdate?.()
    }
    setIsSubmitting(false)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="text-slate-500">{blockIcons[block.block_type]}</div>
        <span className="text-sm font-medium text-slate-700 capitalize">{block.block_type.replace('_', ' ')}</span>
        {block.title && <span className="text-sm text-slate-500">· {block.title}</span>}
        {hasGradedSubmission && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-200 px-2 py-0.5 text-xs font-medium text-success-700">
            <BadgeCheck className="h-3.5 w-3.5" />
            Graded
          </span>
        )}
        <div className="ml-auto">
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
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {block.block_type === 'video' && block.video_url && (
          <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
            {(() => {
              const ytId = getYouTubeId(block.video_url!)
              if (ytId) {
                return (
                  <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
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
                  <a href={block.video_url!} target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline">
                    Open video
                  </a>
                </div>
              )
            })()}
          </div>
        )}

        {block.block_type === 'recording' && block.video_url && (
          <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
            {(() => {
              const ytId = getYouTubeId(block.video_url!)
              if (ytId) {
                return (
                  <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
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

        {(block.block_type === 'exercise' || block.block_type === 'code_challenge') && (
          <div className="mt-4 space-y-3">
            {block.submissions && block.submissions.length > 0 && (
              <div className="space-y-3">
                {block.submissions.map((sub, idx) => {
                  const isLatest = idx === 0
                  const isGraded = sub.grade !== null
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-xl border p-4 ${
                        isGraded
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
                        {isLatest && !isGraded && (
                          <span className="text-xs font-medium text-primary-600 bg-primary-100 px-2 py-0.5 rounded-full">
                            Latest
                          </span>
                        )}
                        {isGraded && <GradeDisplay grade={sub.grade} size="md" />}
                      </div>

                      <div className="mt-2">
                        <CodeEditor
                          value={sub.text || 'No text submitted'}
                          language={detectedLang}
                          readOnly
                          minHeight={120}
                        />
                      </div>

                      {isGraded && (
                        <div className="mt-3 rounded-lg border border-success-200 bg-white p-3">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-semibold text-success-700">Instructor Feedback</p>
                            {sub.graded_at && (
                              <p className="text-xs text-slate-400">
                                Graded {new Date(sub.graded_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          {sub.feedback ? (
                            <p className="text-sm text-slate-700">{sub.feedback}</p>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No feedback provided.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  {block.submissions && block.submissions.length > 0 ? 'Revise your answer' : 'Write your solution'}
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
