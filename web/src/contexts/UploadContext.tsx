import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, X, CheckCircle2, AlertCircle, Film, ChevronDown, ChevronUp } from 'lucide-react'
import { uploadToS3, formatFileSize, type UploadProgress } from '../lib/uploadToS3'
import { api } from '../lib/api'

interface ActiveUpload {
  id: string
  fileName: string
  fileSize: number
  progress: number
  status: 'presigning' | 'uploading' | 'saving' | 'done' | 'error'
  error?: string
  s3Key?: string
  contentBlockId?: number
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

  const startVideoUpload = useCallback((
    file: File,
    opts?: UploadStartOpts
  ): UploadStartResult => {
    const id = crypto.randomUUID()
    const abortController = new AbortController()
    const contentType = file.type || 'video/mp4'

    const upload: ActiveUpload = {
      id, fileName: file.name, fileSize: file.size,
      progress: 0, status: 'presigning', abortController,
      contentBlockId: opts?.contentBlockId,
      linkTo: opts?.linkTo,
      linkLabel: opts?.linkLabel,
    }
    setUploads(prev => [...prev, upload])

    const result = (async (): Promise<UploadResult | null> => {
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

        updateUpload(id, { status: 'saving', progress: 100 })

        if (opts?.contentBlockId) {
          const res = await api.updateContentBlock(opts.contentBlockId, {
            s3_video_key: s3_key, s3_video_content_type: contentType,
            s3_video_size: file.size, video_url: null,
          })
          if (res.error) throw new Error(res.error)
        } else if (opts?.cohortRecording) {
          const res = await api.createRecording(opts.cohortRecording.cohortId, {
            title: opts.cohortRecording.title,
            description: opts.cohortRecording.description,
            s3_key, content_type: contentType, file_size: file.size,
            recorded_date: opts.cohortRecording.recordedDate,
          })
          if (res.error) throw new Error(res.error)
        }

        updateUpload(id, { status: 'done' })
        setTimeout(() => removeUpload(id), 5000)

        return { s3Key: s3_key, contentType, fileSize: file.size }
      } catch (err) {
        if (abortController.signal.aborted) {
          removeUpload(id)
          return null
        }
        const msg = err instanceof Error ? err.message : 'Upload failed'
        updateUpload(id, { status: 'error', error: msg })
        return null
      }
    })()

    return { uploadId: id, result }
  }, [updateUpload, removeUpload])

  const cancelUpload = useCallback((id: string) => {
    const u = uploadsRef.current.find(u => u.id === id)
    if (u) u.abortController.abort()
    removeUpload(id)
  }, [removeUpload])

  return (
    <UploadContext.Provider value={{ uploads, startVideoUpload, cancelUpload }}>
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
