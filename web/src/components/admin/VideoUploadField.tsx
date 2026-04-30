import { useState, useCallback, useEffect, useMemo } from 'react'
import { Upload, Film, X, Link2, Loader2, ArrowRightLeft, CircleOff, CheckCircle2 } from 'lucide-react'
import { useUpload } from '../../contexts/UploadContext'

interface VideoUploadFieldProps {
  contentBlockId?: number | null
  lessonId?: number | null
  contextLabel?: string
  videoUrl: string
  onVideoUrlChange: (url: string) => void
  s3VideoKey: string | null
  onS3VideoUploaded: (data: { s3_video_key: string; s3_video_content_type: string; s3_video_size: number }) => void
  onS3VideoRemoved: () => void
  onUploadStarted?: (uploadId: string) => void
  compact?: boolean
}

export function VideoUploadField({
  contentBlockId,
  lessonId,
  contextLabel,
  videoUrl,
  onVideoUrlChange,
  s3VideoKey,
  onS3VideoUploaded,
  onS3VideoRemoved,
  onUploadStarted,
  compact,
}: VideoUploadFieldProps) {
  const { startVideoUpload, uploads, cancelUpload } = useUpload()

  const existingUpload = contentBlockId
    ? uploads.find(u => u.contentBlockId === contentBlockId && u.status !== 'done' && u.status !== 'error')
    : null

  const [mode, setMode] = useState<'url' | 'upload'>(s3VideoKey || existingUpload ? 'upload' : 'url')
  const [uploadId, setUploadId] = useState<string | null>(existingUpload?.id || null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(
    existingUpload?.fileName || (s3VideoKey ? s3VideoKey.split('/').pop() || null : null)
  )
  const [error, setError] = useState<string | null>(null)

  const activeUpload = uploads.find(u => u.id === uploadId) || existingUpload || null
  const isUploading = activeUpload && activeUpload.status !== 'done' && activeUpload.status !== 'error'
  const trimmedVideoUrl = videoUrl.trim()
  const activeSource = useMemo<'url' | 'upload' | null>(() => {
    if (s3VideoKey || isUploading) return 'upload'
    if (trimmedVideoUrl) return 'url'
    return null
  }, [isUploading, s3VideoKey, trimmedVideoUrl])
  const activeSourceLabel = activeSource === 'upload' ? 'Self-hosted upload' : activeSource === 'url' ? 'Video link' : 'No source selected'

  useEffect(() => {
    if (activeUpload && activeUpload.id !== uploadId) {
      setUploadId(activeUpload.id)
      setUploadedFileName(activeUpload.fileName)
      setMode('upload')
    }
  }, [activeUpload, uploadId])

  // Sync s3_key into parent state. Re-runs whenever the active upload's s3Key changes
  // OR the parent's s3VideoKey diverges from it. This protects against a race where the
  // parent re-fetches the lesson (with a still-null s3_video_key in DB) AFTER we initially
  // reported the key — without this re-sync, the parent would be stuck with null until the
  // user navigates away and the upload's PATCH eventually completes.
  useEffect(() => {
    if (!activeUpload?.s3Key || activeUpload.status === 'error') return
    if (s3VideoKey === activeUpload.s3Key) return
    // Use the authoritative content type captured from the original File at upload
    // start (file.type, the same value sent to the presign endpoint and used in
    // the S3 PUT). Re-deriving from the filename extension here would silently
    // mis-tag uploads whose extension doesn't match the actual MIME (.mkv, .m4v,
    // unusual .mov containers, etc.) and could drift from the object's real
    // Content-Type stored in S3.
    onS3VideoUploaded({
      s3_video_key: activeUpload.s3Key,
      s3_video_content_type: activeUpload.contentType,
      s3_video_size: activeUpload.fileSize,
    })
    onVideoUrlChange('')
  }, [activeUpload?.s3Key, activeUpload?.status, activeUpload?.contentType, activeUpload?.fileSize, s3VideoKey, onS3VideoUploaded, onVideoUrlChange])

  const startUpload = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file')
      return
    }
    if (file.size > 5 * 1024 * 1024 * 1024) {
      setError('File must be under 5 GB')
      return
    }

    setError(null)
    setUploadedFileName(file.name)

    const linkTo = lessonId ? `/admin/lessons/${lessonId}/edit` : undefined
    const { uploadId: newId } = startVideoUpload(
      file,
      contentBlockId
        ? { contentBlockId, linkTo, linkLabel: contextLabel }
        : { linkTo, linkLabel: contextLabel }
    )
    setUploadId(newId)
    onUploadStarted?.(newId)
  }, [contentBlockId, lessonId, contextLabel, startVideoUpload, onUploadStarted])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) startUpload(files[0])
  }, [startUpload])

  const handleRemoveS3Video = () => {
    if (activeUpload?.id && activeUpload.status !== 'done' && activeUpload.status !== 'error') {
      cancelUpload(activeUpload.id)
    }
    setUploadedFileName(null)
    setUploadId(null)
    onS3VideoRemoved()
  }

  const handleClearUrl = () => {
    onVideoUrlChange('')
  }

  const handleSwitchToUrl = () => {
    handleRemoveS3Video()
    setMode('url')
  }

  const handleSwitchToUpload = () => {
    if (trimmedVideoUrl) handleClearUrl()
    setMode('upload')
  }

  const handleModeSelect = (nextMode: 'url' | 'upload') => {
    if (nextMode === 'url') {
      if (activeSource === 'upload') {
        handleSwitchToUrl()
      } else {
        setMode('url')
      }
      return
    }

    if (activeSource === 'url') {
      handleSwitchToUpload()
    } else {
      setMode('upload')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              Video {compact && <span className="font-normal text-slate-400">(optional)</span>}
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Pick one source. You can switch between a YouTube/video URL and a self-hosted upload at any time.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => handleModeSelect('url')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'url' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" />
              Use link
            </button>
            <button
              type="button"
              onClick={() => handleModeSelect('upload')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'upload' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Use upload
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeSource === 'upload'
                    ? 'bg-primary-50 text-primary-600'
                    : activeSource === 'url'
                      ? 'bg-sky-50 text-sky-600'
                      : 'bg-slate-100 text-slate-400'
                }`}>
                  {activeSource === 'upload' ? <Film className="h-4 w-4" /> : activeSource === 'url' ? <Link2 className="h-4 w-4" /> : <CircleOff className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Currently using</p>
                  <p className="truncate text-sm font-semibold text-slate-900">{activeSourceLabel}</p>
                </div>
              </div>
              <p className="mt-2 truncate text-xs text-slate-500">
                {activeSource === 'upload'
                  ? uploadedFileName || 'Uploaded video file'
                  : activeSource === 'url'
                    ? trimmedVideoUrl
                    : 'No video source is attached yet.'}
              </p>
            </div>
            {activeSource && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Active
              </span>
            )}
          </div>

          {activeSource === 'upload' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSwitchToUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Switch to link
              </button>
              <button
                type="button"
                onClick={handleRemoveS3Video}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5" />
                Stop using upload
              </button>
            </div>
          )}

          {activeSource === 'url' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSwitchToUpload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Switch to upload
              </button>
              <button
                type="button"
                onClick={handleClearUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5" />
                Stop using link
              </button>
            </div>
          )}
        </div>
      </div>

      {mode === 'url' && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Video link</p>
              <p className="text-xs text-slate-500">Paste a YouTube URL or another embeddable video link.</p>
            </div>
            {trimmedVideoUrl && (
              <button
                type="button"
                onClick={handleClearUrl}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="url"
            value={videoUrl}
            onChange={e => onVideoUrlChange(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Self-hosted upload</p>
              <p className="text-xs text-slate-500">Upload the class video directly to use the self-hosted player. You can keep editing or move to another exercise, but keep this browser tab open until uploads complete.</p>
          </div>
          {isUploading && activeUpload ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-primary-500 shrink-0 animate-spin" />
                <span className="text-sm text-slate-700 truncate flex-1">{uploadedFileName}</span>
                <span className="text-xs text-slate-500 tabular-nums shrink-0">
                  {activeUpload.status === 'uploading'
                    ? `${activeUpload.progress}%`
                    : activeUpload.status === 'presigning'
                      ? 'Preparing...'
                      : activeUpload.status === 'waiting'
                        ? 'Waiting...'
                        : 'Saving...'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${activeUpload.status === 'uploading' ? activeUpload.progress : activeUpload.status === 'saving' || activeUpload.status === 'waiting' ? 100 : 5}%` }}
                />
              </div>
              {activeUpload.s3Key && (
                <p className="text-[10px] text-green-600">
                  {activeUpload.status === 'waiting'
                    ? 'Uploaded to storage. Finish creating the exercise and it will attach automatically.'
                    : 'Video attached — you can proceed while it uploads.'}
                </p>
              )}
            </div>
          ) : s3VideoKey ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Film className="h-4 w-4 text-primary-500 shrink-0" />
              <span className="text-sm text-slate-700 truncate flex-1">{uploadedFileName || 'Uploaded video'}</span>
              <button type="button" onClick={handleRemoveS3Video} className="text-slate-400 hover:text-red-500 shrink-0" aria-label="Remove uploaded video">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'video/*'
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) startUpload(file)
                }
                input.click()
              }}
            >
              <Upload className="h-5 w-5 text-slate-300 mx-auto mb-1" />
              <p className="text-xs text-slate-500">
                <span className="text-primary-600 font-medium">Choose a video</span> or drag and drop
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">MP4, MOV, WebM — up to 5 GB</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
