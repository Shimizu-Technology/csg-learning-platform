import { useState, useCallback, useEffect, useRef } from 'react'
import { Upload, Trash2, Film, Calendar, Clock, Plus, X, Pencil, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useUpload } from '../../contexts/UploadContext'

interface S3Recording {
  id: number
  title: string
  description: string | null
  s3_key?: string
  content_type: string
  file_size: number
  file_size_display: string
  duration_seconds: number | null
  duration_display: string | null
  recorded_date: string | null
  position: number
  uploaded_by?: string | null
  created_at: string
}

interface RecordingDraft {
  id: string
  file: File
  title: string
  description: string
  recordedDate: string
  error?: string
}

interface RecordingUploadManagerProps {
  cohortId: number
  onRecordingsChange?: () => void
}

export function RecordingUploadManager({ cohortId, onRecordingsChange }: RecordingUploadManagerProps) {
  const { startVideoUpload } = useUpload()
  const [recordings, setRecordings] = useState<S3Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [uploadDrafts, setUploadDrafts] = useState<RecordingDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDate, setEditDate] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(false)

  const fetchRecordings = useCallback(async () => {
    const res = await api.getCohortRecordings(cohortId)
    if (!mountedRef.current) return

    if (res.error) {
      setError(res.error)
    } else if (res.data?.recordings) {
      setRecordings(res.data.recordings)
      setError(null)
    }
    setLoading(false)
  }, [cohortId])

  useEffect(() => {
    mountedRef.current = true
    void fetchRecordings()
    return () => {
      mountedRef.current = false
    }
  }, [fetchRecordings])

  const clearDrafts = useCallback((keepOpen = false) => {
    setUploadDrafts([])
    setError(null)
    if (!keepOpen) setStatusMessage(null)
    if (!keepOpen) setShowUploadForm(false)
  }, [])

  const appendFiles = useCallback((files: File[]) => {
    if (files.length === 0) return

    const nextDrafts: RecordingDraft[] = []
    const errors: string[] = []

    files.forEach((file) => {
      if (!file.type.startsWith('video/')) {
        errors.push(`${file.name}: not a video file`)
        return
      }
      if (file.size > 5 * 1024 * 1024 * 1024) {
        errors.push(`${file.name}: file must be under 5 GB`)
        return
      }

      nextDrafts.push({
        id: crypto.randomUUID(),
        file,
        title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
        description: '',
        recordedDate: '',
      })
    })

    if (nextDrafts.length > 0) {
      setUploadDrafts((current) => [...current, ...nextDrafts])
      setShowUploadForm(true)
      setStatusMessage(null)
    }

    setError(errors.length > 0 ? errors.join(' · ') : null)
  }, [])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    appendFiles(files)
    event.target.value = ''
  }

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    appendFiles(Array.from(event.dataTransfer.files || []))
  }, [appendFiles])

  const updateDraft = useCallback((id: string, patch: Partial<RecordingDraft>) => {
    setUploadDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
  }, [])

  const removeDraft = useCallback((id: string) => {
    setUploadDrafts((current) => current.filter((draft) => draft.id !== id))
  }, [])

  const launchDraftUpload = useCallback((draft: RecordingDraft, options?: { announce?: boolean }) => {
    const trimmedTitle = draft.title.trim()
    if (!trimmedTitle) {
      updateDraft(draft.id, { error: 'Title is required' })
      return
    }

    setError(null)
    if (options?.announce !== false) {
      setStatusMessage(`Started ${trimmedTitle}. You can leave this page and keep working while it uploads.`)
    }
    setUploadDrafts((current) => current.filter((item) => item.id !== draft.id))

    const { result } = startVideoUpload(draft.file, {
      cohortRecording: {
        cohortId,
        title: trimmedTitle,
        description: draft.description.trim() || undefined,
        recordedDate: draft.recordedDate || undefined,
      },
      linkTo: `/admin/cohorts/${cohortId}`,
      linkLabel: `Recording: ${trimmedTitle}`,
    })

    void result.then((uploadResult) => {
      if (!mountedRef.current) return

      if (uploadResult) {
        void fetchRecordings()
        onRecordingsChange?.()
      } else {
        setError(`Upload failed for ${draft.file.name} — check the upload indicator for details`)
      }
    })
  }, [cohortId, fetchRecordings, onRecordingsChange, startVideoUpload, updateDraft])

  const startAllUploads = () => {
    if (uploadDrafts.length === 0) return

    const count = uploadDrafts.length
    setStatusMessage(
      count === 1
        ? `Started ${uploadDrafts[0].title.trim()}. You can leave this page and keep working while it uploads.`
        : `Started ${count} uploads. You can leave this page and keep working while they upload in the background.`
    )
    uploadDrafts.forEach((draft) => launchDraftUpload(draft, { announce: false }))
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this recording? This cannot be undone.')) return
    const res = await api.deleteRecording(cohortId, id)
    if (res.error) {
      setError(res.error)
      return
    }
    void fetchRecordings()
    onRecordingsChange?.()
  }

  const startEdit = (rec: S3Recording) => {
    setEditingId(rec.id)
    setEditTitle(rec.title)
    setEditDescription(rec.description || '')
    setEditDate(rec.recorded_date ? rec.recorded_date.split('T')[0] : '')
  }

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim() || savingEdit) return

    setSavingEdit(true)
    try {
      const res = await api.updateRecording(cohortId, editingId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        recorded_date: editDate || null,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setEditingId(null)
      void fetchRecordings()
    } finally {
      setSavingEdit(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-primary-500" />
          <h3 className="text-sm font-semibold text-slate-900">Uploaded Recordings</h3>
          <span className="text-xs text-slate-400">({recordings.length})</span>
        </div>
        <button
          onClick={() => {
            setShowUploadForm(true)
            fileInputRef.current?.click()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {showUploadForm ? 'Add files' : 'Upload'}
        </button>
      </div>

      {showUploadForm && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-slate-900">Queue Recording Uploads</h4>
              <p className="text-xs text-slate-500 mt-1">
                Start one or many uploads, then keep using the app while they finish in the background.
              </p>
            </div>
            <button onClick={() => clearDrafts()} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-5 sm:p-6 text-center hover:border-primary-400 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              <span className="text-primary-600 font-medium">Choose videos</span> or drag and drop
            </p>
            <p className="text-xs text-slate-400 mt-1">MP4, MOV, WebM — up to 5 GB each</p>
          </div>

          {uploadDrafts.length > 0 && (
            <div className="space-y-3">
              {uploadDrafts.map((draft) => (
                <div key={draft.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <Film className="h-5 w-5 text-primary-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{draft.file.name}</p>
                      <p className="text-xs text-slate-500">{formatSize(draft.file.size)}</p>
                    </div>
                    <button onClick={() => removeDraft(draft.id)} className="text-slate-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(event) => updateDraft(draft.id, { title: event.target.value, error: undefined })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Date recorded</label>
                      <input
                        type="date"
                        value={draft.recordedDate}
                        onChange={(event) => updateDraft(draft.id, { recordedDate: event.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(event) => updateDraft(draft.id, { description: event.target.value })}
                        placeholder="Optional description"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>

                  {draft.error && <p className="text-xs text-red-600">{draft.error}</p>}

                  <div className="flex justify-end">
                    <button
                      onClick={() => launchDraftUpload(draft)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Start upload
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              onClick={() => clearDrafts()}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Add more files
              </button>
              <button
                onClick={startAllUploads}
                disabled={uploadDrafts.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                Start all uploads
              </button>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {statusMessage}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {recordings.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-400">
          No uploaded recordings yet. Click "Upload" to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 hover:border-slate-300 transition-colors"
            >
              {editingId === rec.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={savingEdit}
                      className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={savingEdit || !editTitle.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
                      {savingEdit ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{rec.title}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                      {rec.recorded_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(rec.recorded_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {rec.duration_display && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {rec.duration_display}
                        </span>
                      )}
                      <span>{rec.file_size_display}</span>
                      <span className="text-slate-400">by {rec.uploaded_by || 'Unknown'}</span>
                    </div>
                    {rec.description && (
                      <p className="text-xs text-slate-500 mt-1">{rec.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(rec)}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
