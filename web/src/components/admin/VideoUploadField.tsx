import { useState, useCallback } from 'react'
import { Upload, Film, X, Link2 } from 'lucide-react'
import { api } from '../../lib/api'

interface VideoUploadFieldProps {
  contentBlockId: number | null
  videoUrl: string
  onVideoUrlChange: (url: string) => void
  s3VideoKey: string | null
  onS3VideoUploaded: (data: { s3_video_key: string; s3_video_content_type: string; s3_video_size: number }) => void
  onS3VideoRemoved: () => void
}

export function VideoUploadField({
  contentBlockId,
  videoUrl,
  onVideoUrlChange,
  s3VideoKey,
  onS3VideoUploaded,
  onS3VideoRemoved,
}: VideoUploadFieldProps) {
  const [mode, setMode] = useState<'url' | 'upload'>(s3VideoKey ? 'upload' : 'url')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(s3VideoKey ? s3VideoKey.split('/').pop() || null : null)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file')
      return
    }
    if (file.size > 5 * 1024 * 1024 * 1024) {
      setError('File must be under 5 GB')
      return
    }
    if (!contentBlockId) {
      setError('Save the exercise first, then upload a video')
      return
    }

    setError(null)
    setUploading(true)
    setUploadProgress('Getting upload URL...')

    const presignRes = await api.presignContentBlockVideo(contentBlockId, file.name, file.type || 'video/mp4')
    if (!presignRes.data) {
      setError(presignRes.error || 'Failed to get upload URL')
      setUploading(false)
      setUploadProgress(null)
      return
    }

    const { upload_url, fields, s3_key } = presignRes.data
    setUploadProgress('Uploading video...')

    try {
      const formData = new FormData()
      Object.entries(fields).forEach(([key, value]) => formData.append(key, value))
      formData.append('file', file)

      const uploadRes = await fetch(upload_url, { method: 'POST', body: formData })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)

      setUploadProgress('Saving...')

      const updateRes = await api.updateContentBlock(contentBlockId, {
        s3_video_key: s3_key,
        s3_video_content_type: file.type || 'video/mp4',
        s3_video_size: file.size,
        video_url: null,
      })

      if (updateRes.error) {
        setError(updateRes.error)
      } else {
        setUploadedFileName(file.name)
        onS3VideoUploaded({
          s3_video_key: s3_key,
          s3_video_content_type: file.type || 'video/mp4',
          s3_video_size: file.size,
        })
        onVideoUrlChange('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }

    setUploading(false)
    setUploadProgress(null)
  }, [contentBlockId, onS3VideoUploaded, onVideoUrlChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) handleFileSelect(files[0])
  }, [handleFileSelect])

  const handleRemoveS3Video = async () => {
    if (!contentBlockId) return
    await api.updateContentBlock(contentBlockId, {
      s3_video_key: null,
      s3_video_content_type: null,
      s3_video_size: null,
    })
    setUploadedFileName(null)
    onS3VideoRemoved()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-semibold text-slate-700">Video</label>
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
          {s3VideoKey || uploadedFileName ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Film className="h-4 w-4 text-primary-500 shrink-0" />
              <span className="text-sm text-slate-700 truncate flex-1">{uploadedFileName || 'Uploaded video'}</span>
              <button
                type="button"
                onClick={handleRemoveS3Video}
                className="text-slate-400 hover:text-red-500 shrink-0"
              >
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
                  if (file) handleFileSelect(file)
                }
                input.click()
              }}
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-primary-500 border-t-transparent rounded-full" />
                  <span className="text-sm text-slate-600">{uploadProgress}</span>
                </div>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-slate-300 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">
                    <span className="text-primary-600 font-medium">Choose a video</span> or drag and drop
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">MP4, MOV, WebM — up to 5 GB</p>
                  {!contentBlockId && (
                    <p className="text-[10px] text-amber-600 mt-1">Save the exercise first to enable upload</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
