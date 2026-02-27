import { useState } from 'react'
import { Play, FileText, Code, CheckCircle2, Circle, ChevronDown, ChevronUp, Send } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { GradeDisplay } from './GradeDisplay'
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
  const [isCompleted, setIsCompleted] = useState(block.progress?.status === 'completed')
  const [showSolution, setShowSolution] = useState(false)
  const [submissionText, setSubmissionText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="text-slate-500">{blockIcons[block.block_type]}</div>
        <span className="text-sm font-medium text-slate-700 capitalize">{block.block_type.replace('_', ' ')}</span>
        {block.title && <span className="text-sm text-slate-500">· {block.title}</span>}
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

      {/* Content */}
      <div className="p-4 lg:p-6">
        {/* Video embed */}
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
                const hashParam = vimeo.hash ? `?h=${vimeo.hash}` : ''
                return (
                  <iframe
                    src={`https://player.vimeo.com/video/${vimeo.id}${hashParam}`}
                    className="w-full h-full"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                  />
                )
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

        {/* Recording embed (same as video) */}
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
                const hashParam = vimeo.hash ? `?h=${vimeo.hash}` : ''
                return (
                  <iframe
                    src={`https://player.vimeo.com/video/${vimeo.id}${hashParam}`}
                    className="w-full h-full"
                    allowFullScreen
                  />
                )
              }
              return null
            })()}
          </div>
        )}

        {/* Text/body content */}
        {block.body && (
          <div className={block.block_type === 'video' ? 'mt-4' : ''}>
            <MarkdownRenderer content={block.body} />
          </div>
        )}

        {/* Filename hint */}
        {block.filename && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
            <Code className="h-3.5 w-3.5" />
            <span className="font-mono">{block.filename}</span>
          </div>
        )}

        {/* Exercise submission area */}
        {(block.block_type === 'exercise' || block.block_type === 'code_challenge') && (
          <div className="mt-4 space-y-3">
            {/* Show existing submissions */}
            {block.submissions && block.submissions.length > 0 && (
              <div className="space-y-2">
                {block.submissions.map((sub) => (
                  <div key={sub.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-slate-500">Submission #{sub.num_submissions}</span>
                      {sub.grade && <GradeDisplay grade={sub.grade} size="sm" />}
                    </div>
                    {sub.feedback && (
                      <p className="text-sm text-slate-600 italic">{sub.feedback}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Submission input */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <textarea
                value={submissionText}
                onChange={(e) => setSubmissionText(e.target.value)}
                placeholder="Paste your code or write your answer here..."
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm font-mono resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !submissionText.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Solution (staff only) */}
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
              <div className="mt-2 rounded-xl bg-slate-900 p-4">
                <pre className="text-sm text-slate-100 whitespace-pre-wrap font-mono">{block.solution}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
