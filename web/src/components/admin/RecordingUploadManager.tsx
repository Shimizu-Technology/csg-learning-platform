import { useState, useCallback, useEffect, useRef } from 'react'
import { Upload, Trash2, Film, Calendar, Clock, Plus, X, Pencil, Loader2, Eye, ExternalLink, Link2, Globe2, EyeOff } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { MAX_CONCURRENT_VIDEO_UPLOADS, useUpload } from '../../contexts/UploadContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { VideoPlayer } from '../shared/VideoPlayer'
import { isSupportedVideoFile, videoCompatibilityWarning, VIDEO_FILE_ACCEPT } from '../../lib/videoUploadValidation'
import { VideoUploadWarning } from './VideoUploadWarning'
import { Button, IconButton } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatShortDate, formatShortDateTime } from '../../lib/format'

interface S3Recording {
  id: number
  title: string
  description: string | null
  s3_key?: string
  source: 'uploaded' | 'youtube' | 'vimeo' | 'loom' | 'direct' | 'external'
  url?: string | null
  content_type: string | null
  file_size: number | null
  file_size_display: string | null
  duration_seconds: number | null
  duration_display: string | null
  status: 'draft' | 'published'
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
  warning?: string
}

interface RecordingUploadManagerProps {
  cohortId: number
  onRecordingsChange?: () => void
}

export function RecordingUploadManager({ cohortId, onRecordingsChange }: RecordingUploadManagerProps) {
  const { startVideoUpload, uploads, cancelUpload } = useUpload()
  const toast = useToast()
  const confirmAction = useConfirm()
  const [recordings, setRecordings] = useState<S3Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [uploadDrafts, setUploadDrafts] = useState<RecordingDraft[]>([])
  const [publishImmediately, setPublishImmediately] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkDescription, setLinkDescription] = useState('')
  const [linkDate, setLinkDate] = useState('')
  const [linkPublishImmediately, setLinkPublishImmediately] = useState(false)
  const [savingLink, setSavingLink] = useState(false)
  const [previewRecording, setPreviewRecording] = useState<S3Recording | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(false)

  const fetchRecordings = useCallback(async () => {
    const res = await api.getCohortRecordings(cohortId)
    if (!mountedRef.current) return

    if (res.error) {
      setError(res.error)
      toast.error(res.error)
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
    setPublishImmediately(false)
    setError(null)
    if (!keepOpen) setStatusMessage(null)
    if (!keepOpen) setShowUploadForm(false)
  }, [])

  const appendFiles = useCallback((files: File[]) => {
    if (files.length === 0) return

    const nextDrafts: RecordingDraft[] = []
    const errors: string[] = []

    files.forEach((file) => {
      if (!isSupportedVideoFile(file)) {
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
        warning: videoCompatibilityWarning(file) || undefined,
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
      const message = `Started ${trimmedTitle}. It will ${publishImmediately ? 'publish when the upload finishes' : 'stay a draft until you publish it'}. Keep this browser tab open.`
      setStatusMessage(message)
      toast.success(message)
    }
    setUploadDrafts((current) => current.filter((item) => item.id !== draft.id))

    const { result } = startVideoUpload(draft.file, {
      cohortRecording: {
        cohortId,
        title: trimmedTitle,
        description: draft.description.trim() || undefined,
        recordedDate: draft.recordedDate || undefined,
        publishImmediately,
      },
      linkTo: `/admin/cohorts/${cohortId}`,
      linkLabel: `Recording: ${trimmedTitle}`,
    })

    void result.then((uploadResult) => {
      if (!mountedRef.current) return

      if (uploadResult) {
        void fetchRecordings()
        onRecordingsChange?.()
      }
    })
  }, [cohortId, fetchRecordings, onRecordingsChange, publishImmediately, startVideoUpload, updateDraft])

  const startAllUploads = () => {
    const invalidDraftIds = uploadDrafts
      .filter((draft) => !draft.title.trim())
      .map((draft) => draft.id)

    if (invalidDraftIds.length > 0) {
      setUploadDrafts((current) => current.map((draft) => (
        invalidDraftIds.includes(draft.id)
          ? { ...draft, error: 'Title is required' }
          : draft
      )))
      setError(
        invalidDraftIds.length === 1
          ? 'Add a title for the highlighted recording before starting uploads.'
          : 'Add titles for the highlighted recordings before starting uploads.'
      )
    } else {
      setError(null)
    }

    const startableDrafts = uploadDrafts.filter((draft) => draft.title.trim())
    if (startableDrafts.length === 0) return

    const count = startableDrafts.length
    const message =
      count === 1
        ? `Started ${startableDrafts[0].title.trim()}. It will ${publishImmediately ? 'publish when the upload finishes' : 'stay a draft until you publish it'}. Keep this browser tab open.`
        : `Started ${count} uploads. They will ${publishImmediately ? 'publish when the uploads finish' : 'stay as drafts until you publish them'}. Keep this browser tab open.`
    setStatusMessage(message)
    toast.success(message)
    startableDrafts.forEach((draft) => launchDraftUpload(draft, { announce: false }))
  }

  const handleDelete = async (id: number) => {
    if (!await confirmAction({
      title: 'Delete recording?',
      description: 'Students will immediately lose access to this recording. This cannot be undone.',
      confirmLabel: 'Delete recording',
      tone: 'danger',
    })) return
    const res = await api.deleteRecording(cohortId, id)
    if (res.error) {
      setError(res.error)
      toast.error(res.error)
      return
    }
    toast.success('Recording deleted')
    void fetchRecordings()
    onRecordingsChange?.()
  }

  const startEdit = (rec: S3Recording) => {
    setEditingId(rec.id)
    setEditTitle(rec.title)
    setEditDescription(rec.description || '')
    setEditDate(rec.recorded_date ? rec.recorded_date.split('T')[0] : '')
    setEditUrl(rec.url || '')
  }

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim() || savingEdit) return

    setSavingEdit(true)
    try {
      const res = await api.updateRecording(cohortId, editingId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        recorded_date: editDate || null,
        ...(recordings.find((recording) => recording.id === editingId)?.source !== 'uploaded' ? { source_url: editUrl.trim() } : {}),
      })
      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      setEditingId(null)
      toast.success('Recording updated')
      void fetchRecordings()
    } finally {
      setSavingEdit(false)
    }
  }

  const saveLink = async () => {
    if (!linkTitle.trim() || !linkUrl.trim() || savingLink) return
    setSavingLink(true)
    setError(null)
    try {
      const res = await api.createRecording(cohortId, {
        title: linkTitle.trim(),
        source_url: linkUrl.trim(),
        description: linkDescription.trim() || undefined,
        recorded_date: linkDate || undefined,
        publish_immediately: linkPublishImmediately,
      })
      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      setShowLinkForm(false)
      setLinkTitle('')
      setLinkUrl('')
      setLinkDescription('')
      setLinkDate('')
      setLinkPublishImmediately(false)
      toast.success(linkPublishImmediately ? 'Recording link published' : 'Recording link saved as a draft')
      void fetchRecordings()
      onRecordingsChange?.()
    } finally {
      setSavingLink(false)
    }
  }

  const changeStatus = async (recording: S3Recording) => {
    if (updatingStatusId) return

    const nextStatus = recording.status === 'published' ? 'draft' : 'published'
    if (nextStatus === 'draft' && !await confirmAction({
      title: 'Return recording to draft?',
      description: 'Students will immediately lose access until you publish it again.',
      confirmLabel: 'Return to draft',
      tone: 'danger',
    })) return

    setUpdatingStatusId(recording.id)
    try {
      const res = await api.updateRecording(cohortId, recording.id, { status: nextStatus })
      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        return
      }

      toast.success(nextStatus === 'published' ? 'Recording published' : 'Recording returned to draft')
      void fetchRecordings()
      onRecordingsChange?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update recording access'
      setError(message)
      toast.error(message)
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const formatUploadedAt = (value?: string | null) => {
    return formatShortDateTime(value, 'time unknown')
  }

  const activeUploads = uploads.filter((upload) => (
    upload.cohortRecording?.cohortId === cohortId &&
    upload.status !== 'done' &&
    upload.status !== 'error'
  ))

  const fetchPreviewStreamUrl = useCallback(async () => {
    if (!previewRecording || previewRecording.source !== 'uploaded') return null
    const res = await api.getRecordingStreamUrl(cohortId, previewRecording.id)
    return res.data?.stream_url || null
  }, [cohortId, previewRecording])

  const publishedRecordings = recordings.filter((recording) => recording.status === 'published')
  const draftCount = recordings.length - publishedRecordings.length
  const libraryItems = publishedRecordings.map((recording) => ({
      key: `recording-${recording.id}`,
      title: recording.title,
      description: recording.description,
      source: sourceLabel(recording.source),
      date: recording.recorded_date,
      meta: [recording.duration_display, recording.file_size_display].filter(Boolean).join(' · '),
      recording: recording.source === 'uploaded' ? recording : null,
      url: recording.url || null,
    }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-ink-muted border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-ink-muted" />
          <h3 className="text-base font-semibold text-ink">Recording library</h3>
          <span className="text-xs text-ink-muted tabular-nums">({publishedRecordings.length} published{draftCount > 0 ? ` · ${draftCount} draft${draftCount === 1 ? '' : 's'}` : ''})</span>
        </div>
        <div className="flex gap-2"><Button
          variant="secondary"
          size="sm"
          onClick={() => setShowLinkForm((current) => !current)}
        >
          <Link2 className="h-3.5 w-3.5" />
          Add link
        </Button><Button
          size="sm"
          onClick={() => {
            setShowUploadForm(true)
            fileInputRef.current?.click()
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {showUploadForm ? 'Add files' : 'Upload'}
        </Button></div>
      </div>

      {showLinkForm && (
        <div className="app-surface-muted space-y-3 p-4">
          <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-ink">Add a hosted recording</h4><p className="mt-1 text-xs text-ink-muted">YouTube, Vimeo, Loom, direct video, or another secure link.</p></div><IconButton label="Close link form" size="sm" onClick={() => setShowLinkForm(false)}><X className="h-4 w-4" /></IconButton></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-ink-secondary">Title *<input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Week 1 class replay" className="app-control mt-1 w-full" /></label><label className="text-xs font-semibold text-ink-secondary">Date recorded<input type="date" value={linkDate} onChange={(event) => setLinkDate(event.target.value)} className="app-control mt-1 w-full" /></label></div>
          <label className="block text-xs font-semibold text-ink-secondary">Secure video link *<input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." className="app-control mt-1 w-full" /></label>
          <label className="block text-xs font-semibold text-ink-secondary">Description<input value={linkDescription} onChange={(event) => setLinkDescription(event.target.value)} placeholder="Topics covered in this class" className="app-control mt-1 w-full" /></label>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5"><input type="checkbox" checked={linkPublishImmediately} onChange={(event) => setLinkPublishImmediately(event.target.checked)} className="h-5 w-5 rounded border-line-strong text-primary-600" /><span><span className="block text-sm font-semibold text-ink">Publish immediately</span><span className="block text-xs text-ink-muted">Leave off to review the link privately first.</span></span></label>
          <div className="flex justify-end"><Button onClick={() => void saveLink()} disabled={savingLink || !linkTitle.trim() || !linkUrl.trim()}>{savingLink && <Loader2 className="h-4 w-4 animate-spin" />}{savingLink ? 'Saving…' : linkPublishImmediately ? 'Add and publish' : 'Save as draft'}</Button></div>
        </div>
      )}

      {showUploadForm && (
        <div className="app-surface-muted p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-ink">Queue recording uploads</h4>
              <p className="text-xs text-ink-muted mt-1">
                Start one or many uploads, then keep using the app while they finish. Keep this browser tab open until uploads complete.
              </p>
            </div>
            <IconButton label="Close upload form" size="sm" onClick={() => clearDrafts()}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          <button
            type="button"
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            className="pressable block min-h-11 w-full border-2 border-dashed border-line-strong rounded-xl bg-surface-raised p-5 sm:p-6 text-center hover:border-slate-400 hover:bg-surface-sunken cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-ink-muted mx-auto mb-2" />
            <span className="block text-sm text-ink-secondary">
              <span className="font-semibold text-ink underline underline-offset-2">Choose videos</span> or drag and drop
            </span>
            <span className="block text-xs text-ink-muted mt-1">MP4, MOV, WebM — up to 5 GB each</span>
          </button>

          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5">
            <input
              type="checkbox"
              checked={publishImmediately}
              onChange={(event) => setPublishImmediately(event.target.checked)}
              className="h-5 w-5 rounded border-line-strong text-primary-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">Publish immediately</span>
              <span className="block text-xs text-ink-muted">
                {publishImmediately
                  ? 'Students will get access as soon as each upload finishes.'
                  : 'Recommended: uploads stay private drafts until you review and publish them.'}
              </span>
            </span>
          </label>

          {uploadDrafts.length > 0 && (
            <div className="space-y-3">
              {uploadDrafts.map((draft) => (
                <div key={draft.id} className="rounded-xl border border-line bg-surface-raised p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <Film className="h-5 w-5 text-ink-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink truncate" title={draft.file.name}>{draft.file.name}</p>
                      <p className="text-xs text-ink-muted tabular-nums">{formatSize(draft.file.size)}</p>
                    </div>
                    <IconButton label={`Remove ${draft.file.name}`} size="sm" onClick={() => removeDraft(draft.id)}>
                      <X className="h-4 w-4" />
                    </IconButton>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">Title *</label>
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(event) => updateDraft(draft.id, { title: event.target.value, error: undefined })}
                      className="app-control w-full"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-ink-secondary mb-1">Date recorded</label>
                      <input
                        type="date"
                        value={draft.recordedDate}
                        onChange={(event) => updateDraft(draft.id, { recordedDate: event.target.value })}
                        className="app-control w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-ink-secondary mb-1">Description</label>
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(event) => updateDraft(draft.id, { description: event.target.value })}
                        placeholder="Optional description"
                        className="app-control w-full"
                      />
                    </div>
                  </div>

                  {draft.error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{draft.error}</p>}
                  <VideoUploadWarning message={draft.warning} />

                  <div className="flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => launchDraftUpload(draft)}>
                      <Upload className="h-3.5 w-3.5" />
                      {publishImmediately ? 'Upload and publish' : 'Upload as draft'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button variant="quiet" size="sm" onClick={() => clearDrafts()}>
              Close
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                Add more files
              </Button>
              <Button size="sm" onClick={startAllUploads} disabled={uploadDrafts.length === 0}>
                <Upload className="h-3.5 w-3.5" />
                {publishImmediately ? 'Upload and publish all' : 'Upload all as drafts'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <p role="status" className="rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-xs text-success-700">
          {statusMessage}
        </p>
      )}
      {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</p>}

      {activeUploads.length > 0 && (
        <div role="status" className="space-y-2 rounded-xl border border-info-200 bg-info-50 p-3">
          <p className="text-xs font-semibold text-info-800">Uploads in progress</p>
          {activeUploads.map((upload) => (
            <div key={upload.id} className="rounded-xl border border-info-200 bg-surface-raised p-3">
              <div className="flex items-start gap-3">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-info-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink" title={upload.cohortRecording?.title || upload.fileName}>
                    {upload.cohortRecording?.title || upload.fileName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted tabular-nums">
                    {formatSize(upload.fileSize)} · {upload.fileName}
                  </p>
                  <p className="mt-1 text-xs font-medium text-ink-muted">
                    {upload.cohortRecording?.publishImmediately ? 'Publishes when complete' : 'Saves as draft'}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-info-100">
                    <div
                      className="h-full rounded-full bg-info-700 transition-[width] duration-300"
                      style={{ width: `${upload.status === 'uploading' ? upload.progress : upload.status === 'queued' ? 0 : upload.status === 'presigning' ? 5 : 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-info-800 tabular-nums">
                    {upload.status === 'queued'
                      ? `Queued — up to ${MAX_CONCURRENT_VIDEO_UPLOADS} videos upload at a time.`
                      : upload.status === 'presigning'
                      ? 'Preparing upload...'
                      : upload.status === 'saving'
                        ? 'Saving recording...'
                        : `${upload.progress}% uploaded`}
                  </p>
                </div>
                <Button variant="danger" size="sm" className="shrink-0" onClick={() => cancelUpload(upload.id)}>
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {libraryItems.length > 0 && (
        <div className="app-surface-muted p-3">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Student recording library</p>
              <p className="text-xs text-ink-muted">This is exactly what students can access. Drafts remain in the staff list below.</p>
            </div>
            <span className="text-xs font-medium text-ink-muted tabular-nums">
              {libraryItems.length} recording{libraryItems.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {libraryItems.map((item) => (
              <div key={item.key} className="rounded-xl border border-line bg-surface-raised p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral" icon={item.source === 'Uploaded' ? <Upload className="h-3 w-3" /> : item.source === 'YouTube' ? <Film className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}>
                        {item.source}
                      </Badge>
                      {item.date && <span className="text-xs text-ink-muted tabular-nums">{formatDateLabel(item.date)}</span>}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-ink" title={item.title}>{item.title}</p>
                    {item.description && <p className="mt-1 text-xs text-ink-muted">{item.description}</p>}
                    {item.meta && <p className="mt-1 truncate text-xs text-ink-muted tabular-nums">{item.meta}</p>}
                  </div>
                  {item.recording ? (
                    <IconButton label="Preview recording" size="sm" onClick={() => setPreviewRecording(item.recording)}>
                      <Eye className="h-4 w-4" />
                    </IconButton>
                  ) : item.url ? (
                    <a
                      href={sanitizeUrl(item.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
                      aria-label={`Open ${item.title} in a new tab`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewRecording && (
        <div className="app-surface-muted p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink" title={previewRecording.title}>Previewing {previewRecording.title}</p>
              <p className="text-xs text-ink-muted">This admin preview does not update any student watch progress.</p>
            </div>
            <IconButton label="Close preview" size="sm" onClick={() => setPreviewRecording(null)}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <VideoPlayer
            key={previewRecording.id}
            title={previewRecording.title}
            fetchStreamUrl={fetchPreviewStreamUrl}
            onSaveProgress={() => {}}
          />
        </div>
      )}

      {recordings.length === 0 ? (
        <div className="text-center py-6 text-sm text-ink-muted">
          No recordings yet. Upload a video or add a hosted link.
        </div>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className="rounded-xl border border-line bg-surface-raised p-3 sm:p-4 hover:border-line-strong transition-colors duration-150"
            >
              {editingId === rec.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="app-control w-full"
                  />
                  {rec.source !== 'uploaded' && <input type="url" value={editUrl} onChange={(event) => setEditUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." className="app-control w-full" />}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="app-control w-full"
                    />
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description"
                      className="app-control w-full"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="quiet" size="sm" onClick={() => setEditingId(null)} disabled={savingEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={savingEdit || !editTitle.trim()}>
                      {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
                      {savingEdit ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-sm font-semibold text-ink">{rec.title}</p>
                      <Badge tone={rec.status === 'published' ? 'success' : 'neutral'} icon={rec.status === 'published' ? <Globe2 className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}>
                        {rec.status === 'published' ? 'Published' : 'Draft'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-ink-muted tabular-nums">
                      {rec.recorded_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateLabel(rec.recorded_date)}
                        </span>
                      )}
                      {rec.duration_display && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {rec.duration_display}
                        </span>
                      )}
                      {rec.file_size_display && <span>{rec.file_size_display}</span>}
                      <span>{sourceLabel(rec.source)} · added {formatUploadedAt(rec.created_at)}</span>
                      <span>by {rec.uploaded_by || 'Unknown'}</span>
                    </div>
                    {rec.description && (
                      <p className="text-xs text-ink-muted mt-1">{rec.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    <Button
                      variant={rec.status === 'published' ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => void changeStatus(rec)}
                      disabled={updatingStatusId === rec.id}
                    >
                      {updatingStatusId === rec.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : rec.status === 'published'
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Globe2 className="h-3.5 w-3.5" />}
                      {rec.status === 'published' ? 'Return to draft' : 'Publish'}
                    </Button>
                    {rec.source === 'uploaded' ? <IconButton
                      label="Preview"
                      size="sm"
                      onClick={() => setPreviewRecording(rec)}
                    >
                      <Eye className="h-4 w-4" />
                    </IconButton> : rec.url ? <a href={sanitizeUrl(rec.url)} target="_blank" rel="noopener noreferrer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink lg:h-9 lg:w-9" aria-label={`Open ${rec.title}`}><ExternalLink className="h-4 w-4" /></a> : null}
                    <IconButton
                      label="Edit"
                      size="sm"
                      onClick={() => startEdit(rec)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(rec.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
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

function sourceLabel(source: S3Recording['source']): 'Uploaded' | 'YouTube' | 'Vimeo' | 'Loom' | 'Direct video' | 'External' {
  if (source === 'uploaded') return 'Uploaded'
  if (source === 'youtube') return 'YouTube'
  if (source === 'vimeo') return 'Vimeo'
  if (source === 'loom') return 'Loom'
  if (source === 'direct') return 'Direct video'
  return 'External'
}

function formatDateLabel(dateStr: string) {
  return formatShortDate(dateStr, '', { withYear: false })
}
