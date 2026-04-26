import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, X, CheckCircle2, AlertCircle, Film, ChevronDown, ChevronUp } from 'lucide-react'
import { uploadToS3, formatFileSize, type UploadProgress } from '../lib/uploadToS3'
import { api } from '../lib/api'

interface ActiveUpload {
  id: string
  fileName: string
  fileSize: number
  contentType: string
  progress: number
  status: 'presigning' | 'uploading' | 'waiting' | 'saving' | 'done' | 'error'
  error?: string
  s3Key?: string
  contentBlockId?: number
  cohortRecording?: { cohortId: number; title: string; description?: string; recordedDate?: string }
  linkTo?: string
  linkLabel?: string
  abortController: AbortController
}

interface UploadResult {
  s3Key: string
  contentType: string
  fileSize: number
}

interface UploadStartResult {
  uploadId: string
  result: Promise<UploadResult | null>
}

interface UploadStartOpts {
  contentBlockId?: number
  cohortRecording?: { cohortId: number; title: string; description?: string; recordedDate?: string }
  linkTo?: string
  linkLabel?: string
}

interface UploadContextValue {
  uploads: ActiveUpload[]
  startVideoUpload: (file: File, opts?: UploadStartOpts) => UploadStartResult
  cancelUpload: (id: string) => void
  attachUpload: (id: string, patch: { contentBlockId?: number; linkTo?: string; linkLabel?: string }) => void
}

const UploadContext = createContext<UploadContextValue | null>(null)

export function useUpload() {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('useUpload must be used within UploadProvider')
  return ctx
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [uploads, setUploads] = useState<ActiveUpload[]>([])
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  const updateUpload = useCallback((id: string, patch: Partial<ActiveUpload>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
  }, [])

  const removeUpload = useCallback((id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id))
  }, [])

  const completeUpload = useCallback((id: string) => {
    updateUpload(id, { status: 'done' })
    setTimeout(() => removeUpload(id), 5000)
  }, [removeUpload, updateUpload])

  const persistUploadTarget = useCallback(async (
    uploadId: string,
    fallbackOpts: UploadStartOpts,
    s3Key: string,
    contentType: string,
    fileSize: number
  ) => {
    const liveUpload = uploadsRef.current.find((upload) => upload.id === uploadId)
    const contentBlockId = liveUpload?.contentBlockId ?? fallbackOpts.contentBlockId
    const cohortRecording = liveUpload?.cohortRecording ?? fallbackOpts.cohortRecording

    if (contentBlockId) {
      updateUpload(uploadId, { status: 'saving' })
      const res = await api.updateContentBlock(contentBlockId, {
        s3_video_key: s3Key,
        s3_video_content_type: contentType,
        s3_video_size: fileSize,
        video_url: null,
      })
      if (res.error) throw new Error(res.error)
      return true
    }

    if (cohortRecording) {
      updateUpload(uploadId, { status: 'saving' })
      const res = await api.createRecording(cohortRecording.cohortId, {
        title: cohortRecording.title,
        description: cohortRecording.description,
        s3_key: s3Key,
        content_type: contentType,
        file_size: fileSize,
        recorded_date: cohortRecording.recordedDate,
      })
      if (res.error) throw new Error(res.error)
      return true
    }

    return false
  }, [updateUpload])

  const startVideoUpload = useCallback((
    file: File,
    opts?: UploadStartOpts
  ): UploadStartResult => {
    const id = crypto.randomUUID()
    const abortController = new AbortController()
    const contentType = file.type || 'video/mp4'

    const upload: ActiveUpload = {
      id, fileName: file.name, fileSize: file.size, contentType,
      progress: 0, status: 'presigning', abortController,
      contentBlockId: opts?.contentBlockId,
      cohortRecording: opts?.cohortRecording,
      linkTo: opts?.linkTo,
      linkLabel: opts?.linkLabel,
    }
    setUploads(prev => [...prev, upload])

    const result = (async (): Promise<UploadResult | null> => {
      // Track whether the S3 PUT actually completed so the catch handler can
      // clean up an orphaned object if the subsequent DB write fails.
      let uploadedS3Key: string | null = null
      try {
        let presignRes
        if (opts?.contentBlockId) {
          presignRes = await api.presignContentBlockVideo(opts.contentBlockId, file.name, contentType)
        } else if (opts?.cohortRecording) {
          presignRes = await api.presignRecordingUpload(opts.cohortRecording.cohortId, file.name, contentType)
        } else {
          presignRes = await api.presignGenericVideo(file.name, contentType)
        }

        if (!presignRes.data) throw new Error(presignRes.error || 'Failed to get upload URL')

        const { upload_url, fields, s3_key } = presignRes.data
        updateUpload(id, { status: 'uploading', s3Key: s3_key })

        await uploadToS3(upload_url, fields, file, (p: UploadProgress) => {
          updateUpload(id, { progress: p.percent })
        }, abortController.signal)

        // Past this point the object is in the bucket — if any of the DB
        // writes below fail, we need to clean it up.
        uploadedS3Key = s3_key
        const persisted = await persistUploadTarget(id, opts || {}, s3_key, contentType, file.size)

        if (persisted) {
          completeUpload(id)
        } else {
          updateUpload(id, { status: 'waiting', progress: 100 })
        }

        return { s3Key: s3_key, contentType, fileSize: file.size }
      } catch (err) {
        if (abortController.signal.aborted) {
          // Cancellation after a successful S3 PUT also leaves an orphan —
          // best-effort cleanup mirrors the error path.
          if (uploadedS3Key) api.abandonUpload(uploadedS3Key).catch(() => {})
          removeUpload(id)
          return null
        }
        // S3 PUT succeeded but the follow-up DB write didn't — the object is
        // now in the bucket with no row pointing at it. Fire-and-forget
        // cleanup so we don't leak storage. Failure here is non-fatal; the
        // object can also be reaped by an S3 lifecycle rule as a backstop.
        if (uploadedS3Key) api.abandonUpload(uploadedS3Key).catch(() => {})
        const msg = err instanceof Error ? err.message : 'Upload failed'
        updateUpload(id, { status: 'error', error: msg })
        return null
      }
    })()

    return { uploadId: id, result }
  }, [completeUpload, persistUploadTarget, removeUpload, updateUpload])

  const cancelUpload = useCallback((id: string) => {
    const u = uploadsRef.current.find(u => u.id === id)
    if (u) u.abortController.abort()
    if (u?.status === 'waiting' && u.s3Key) {
      api.abandonUpload(u.s3Key).catch(() => {})
    }
    removeUpload(id)
  }, [removeUpload])

  const attachUpload = useCallback((id: string, patch: { contentBlockId?: number; linkTo?: string; linkLabel?: string }) => {
    const current = uploadsRef.current.find((upload) => upload.id === id)
    const next = current ? { ...current, ...patch } : null
    updateUpload(id, patch)

    if (next?.contentBlockId && next.s3Key && next.status === 'waiting') {
      const attachedS3Key = next.s3Key
      void (async () => {
        try {
          const persisted = await persistUploadTarget(
            id,
            { contentBlockId: next.contentBlockId, linkTo: next.linkTo, linkLabel: next.linkLabel },
            attachedS3Key,
            next.contentType,
            next.fileSize
          )
          if (persisted) completeUpload(id)
        } catch (error) {
          api.abandonUpload(attachedS3Key).catch(() => {})
          const message = error instanceof Error ? error.message : 'Upload failed'
          updateUpload(id, { status: 'error', error: message })
        }
      })()
    }
  }, [completeUpload, persistUploadTarget, updateUpload])

  return (
    <UploadContext.Provider value={{ uploads, startVideoUpload, cancelUpload, attachUpload }}>
      {children}
      <UploadIndicator uploads={uploads} onCancel={cancelUpload} onDismiss={removeUpload} />
    </UploadContext.Provider>
  )
}

function UploadIndicator({ uploads, onCancel, onDismiss }: {
  uploads: ActiveUpload[]
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const active = uploads.filter(u => u.status !== 'done')

  if (uploads.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200"
      >
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary-600" />
          <span className="text-sm font-medium text-slate-700">
            {active.length > 0
              ? `Uploading ${active.length} file${active.length > 1 ? 's' : ''}...`
              : 'Uploads complete'}
          </span>
        </div>
        {collapsed ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {!collapsed && (
        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
          {uploads.map(u => (
            <div key={u.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <Film className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  {u.linkTo ? (
                    <button
                      type="button"
                      onClick={() => navigate(u.linkTo!)}
                      className="text-left w-full group"
                      title={`Open ${u.linkLabel || u.fileName}`}
                    >
                      <p className="text-sm text-slate-700 truncate group-hover:text-primary-600 group-hover:underline">{u.fileName}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {formatFileSize(u.fileSize)}{u.linkLabel ? ` · ${u.linkLabel}` : ''}
                      </p>
                    </button>
                  ) : (
                    <>
                      <p className="text-sm text-slate-700 truncate">{u.fileName}</p>
                      <p className="text-[11px] text-slate-400">{formatFileSize(u.fileSize)}</p>
                    </>
                  )}
                </div>
                {u.status === 'done' ? (
                  <button onClick={() => onDismiss(u.id)} className="text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : u.status === 'error' ? (
                  <button onClick={() => onDismiss(u.id)} className="text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button onClick={() => onCancel(u.id)} className="text-xs text-slate-500 hover:text-red-500">Cancel</button>
                )}
              </div>
              {u.status === 'uploading' && (
                <div className="space-y-1">
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all duration-300"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 text-right">{u.progress}%</p>
                </div>
              )}
              {u.status === 'presigning' && (
                <p className="text-[11px] text-slate-500">Preparing upload...</p>
              )}
              {u.status === 'saving' && (
                <p className="text-[11px] text-slate-500">Saving...</p>
              )}
              {u.status === 'waiting' && (
                <p className="text-[11px] text-slate-500">Uploaded to storage. Waiting for the exercise to finish attaching...</p>
              )}
              {u.status === 'done' && (
                <div className="flex items-center gap-1 text-[11px] text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Upload complete
                </div>
              )}
              {u.status === 'error' && (
                <div className="flex items-center gap-1 text-[11px] text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {u.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
