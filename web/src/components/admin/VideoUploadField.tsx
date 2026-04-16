import { useState, useCallback, useEffect, useRef } from 'react'
import { Upload, Film, X, Link2, Loader2 } from 'lucide-react'
import { useUpload } from '../../contexts/UploadContext'

interface VideoUploadFieldProps {
  contentBlockId?: number | null
  videoUrl: string
  onVideoUrlChange: (url: string) => void
  s3VideoKey: string | null
  onS3VideoUploaded: (data: { s3_video_key: string; s3_video_content_type: string; s3_video_size: number }) => void
  onS3VideoRemoved: () => void
  compact?: boolean
}

export function VideoUploadField({
  contentBlockId,
  videoUrl,
  onVideoUrlChange,
  s3VideoKey,
  onS3VideoUploaded,
  onS3VideoRemoved,
  compact,
}: VideoUploadFieldProps) {
  const { startVideoUpload, uploads } = useUpload()
  const [mode, setMode] = useState<'url' | 'upload'>(s3VideoKey ? 'upload' : 'url')
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(
    s3VideoKey ? s3VideoKey.split('/').pop() || null : null
  )
  const [error, setError] = useState<string | null>(null)

  const activeUpload = uploads.find(u => u.id === uploadId)
  const isUploading = activeUpload && activeUpload.status !== 'done' && activeUpload.status !== 'error'
  const hasReportedKeyRef = useRef(false)

  useEffect(() => {
    if (hasReportedKeyRef.current) return
    if (activeUpload?.s3Key && activeUpload.status !== 'error') {
      hasReportedKeyRef.current = true
      onS3VideoUploaded({
        s3_video_key: activeUpload.s3Key,
        s3_video_content_type: activeUpload.fileName.endsWith('.webm') ? 'video/webm' : activeUpload.fileName.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
        s3_video_size: activeUpload.fileSize,
      })
      onVideoUrlChange('')
    }
  }, [activeUpload?.s3Key, activeUpload?.status, activeUpload?.fileName, activeUpload?.fileSize, onS3VideoUploaded, onVideoUrlChange])

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
    hasReportedKeyRef.current = false

    const { uploadId: newId } = startVideoUpload(file, contentBlockId ? { contentBlockId } : undefined)
    setUploadId(newId)
  }, [contentBlockId, startVideoUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) startUpload(files[0])
  }, [startUpload])

  const handleRemoveS3Video = () => {
    setUploadedFileName(null)
    setUploadId(null)
    onS3VideoRemoved()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-semibold text-slate-700">
          Video {compact && <span className="font-normal text-slate-400">(optional)</span>}
        </label>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'url' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Link2 className="h-3 w-3" />
            URL
          </button>
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'upload' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Upload className="h-3 w-3" />
            Upload
          </button>
        </div>
      </div>

      {mode === 'url' && (
        <input
          type="url"
          value={videoUrl}
          onChange={e => onVideoUrlChange(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      )}

      {mode === 'upload' && (
        <>
          {isUploading && activeUpload ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-primary-500 shrink-0 animate-spin" />
                <span className="text-sm text-slate-700 truncate flex-1">{uploadedFileName}</span>
                <span className="text-xs text-slate-500 tabular-nums shrink-0">
                  {activeUpload.status === 'uploading' ? `${activeUpload.progress}%` : activeUpload.status === 'presigning' ? 'Preparing...' : 'Saving...'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${activeUpload.status === 'uploading' ? activeUpload.progress : activeUpload.status === 'saving' ? 100 : 5}%` }}
                />
              </div>
              {activeUpload.s3Key && (
                <p className="text-[10px] text-green-600">Video attached — you can proceed while it uploads</p>
              )}
            </div>
          ) : s3VideoKey ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Film className="h-4 w-4 text-primary-500 shrink-0" />
              <span className="text-sm text-slate-700 truncate flex-1">{uploadedFileName || 'Uploaded video'}</span>
              <button type="button" onClick={handleRemoveS3Video} className="text-slate-400 hover:text-red-500 shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-primary-400 transition-colors cursor-pointer"
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
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
