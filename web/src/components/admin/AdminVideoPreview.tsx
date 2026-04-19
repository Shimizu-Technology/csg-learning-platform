import { useCallback, useState } from 'react'
import { ChevronDown, ChevronUp, Eye } from 'lucide-react'
import { api } from '../../lib/api'
import { VideoPlayer } from '../shared/VideoPlayer'

interface AdminVideoPreviewProps {
  contentBlockId: number | null
  s3VideoKey: string | null
  videoUrl: string
  title?: string
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function getVimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(\d+)/)
  return match ? match[1] : null
}

/**
 * In-editor video preview for admins. Lets staff watch the attached video
 * without switching to Student Preview. Defaults collapsed; remembers state.
 */
export function AdminVideoPreview({ contentBlockId, s3VideoKey, videoUrl, title }: AdminVideoPreviewProps) {
  const [open, setOpen] = useState(false)

  const fetchStreamUrl = useCallback(async () => {
    if (!contentBlockId) return null
    const res = await api.getContentBlockVideoStream(contentBlockId)
    return res.data?.stream_url || null
  }, [contentBlockId])

  const hasVideo = Boolean(s3VideoKey || videoUrl.trim())
  if (!hasVideo) return null

  // S3 preview requires a persisted content block id (stream endpoint is per-block).
  const canStreamS3 = Boolean(s3VideoKey && contentBlockId && contentBlockId > 0)
  const ytId = videoUrl ? getYouTubeId(videoUrl) : null
  const vimeoId = videoUrl ? getVimeoId(videoUrl) : null

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Eye className="h-3.5 w-3.5" />
          Preview video
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 bg-white p-3">
          {canStreamS3 ? (
            <VideoPlayer
              key={`admin-preview-${contentBlockId}-${s3VideoKey}`}
              title={title || 'Video preview'}
              fetchStreamUrl={fetchStreamUrl}
              onSaveProgress={() => { /* admin preview doesn't track progress */ }}
            />
          ) : s3VideoKey && !contentBlockId ? (
            <p className="text-xs text-slate-500 px-1 py-2">
              Save the exercise first to preview the uploaded video here.
            </p>
          ) : ytId ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
              <iframe
                src={`https://www.youtube.com/embed/${ytId}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={title || 'YouTube video'}
              />
            </div>
          ) : vimeoId ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-slate-900">
              <iframe
                src={`https://player.vimeo.com/video/${vimeoId}`}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={title || 'Vimeo video'}
              />
            </div>
          ) : (
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary-600 hover:underline break-all"
            >
              {videoUrl}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
