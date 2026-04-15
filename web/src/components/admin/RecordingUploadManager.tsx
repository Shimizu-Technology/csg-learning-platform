import { useState, useCallback, useEffect } from 'react'
import { Upload, Trash2, Film, Calendar, Clock, GripVertical, Plus, X, Pencil } from 'lucide-react'
import { api } from '../../lib/api'
import { useUpload } from '../../contexts/UploadContext'

interface S3Recording {
  id: number
  title: string
  description: string | null
  s3_key: string
  content_type: string
  file_size: number
  file_size_display: string
  duration_seconds: number | null
  duration_display: string | null
  recorded_date: string | null
  position: number
  uploaded_by: string
  created_at: string
}

interface RecordingUploadManagerProps {
  cohortId: number
  onRecordingsChange?: () => void
}

export function RecordingUploadManager({ cohortId, onRecordingsChange }: RecordingUploadManagerProps) {
  const { startVideoUpload } = useUpload()
  const [recordings, setRecordings] = useState<S3Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDate, setEditDate] = useState('')

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDate, setNewDate] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const fetchRecordings = useCallback(async () => {
    const res = await api.getCohortRecordings(cohortId)
    if (res.data?.recordings) {
      setRecordings(res.data.recordings)
    }
    setLoading(false)
  }, [cohortId])

  useEffect(() => { fetchRecordings() }, [fetchRecordings])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      if (!file.type.startsWith('video/')) {
        setError('Please select a video file')
        return
      }
      if (file.size > 5 * 1024 * 1024 * 1024) {
        setError('File must be under 5 GB')
        return
      }
      setSelectedFile(file)
      setError(null)
      if (!newTitle) {
        setNewTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '))
      }
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const file = files[0]
      if (!file.type.startsWith('video/')) {
        setError('Please drop a video file')
        return
      }
      if (file.size > 5 * 1024 * 1024 * 1024) {
        setError('File must be under 5 GB')
        return
      }
      setSelectedFile(file)
      setError(null)
      if (!newTitle) {
        setNewTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '))
      }
      setShowUploadForm(true)
    }
  }, [newTitle])

  const handleUpload = async () => {
    if (!selectedFile || !newTitle.trim()) return

    setUploading(true)
    setError(null)

    const result = await startVideoUpload(selectedFile, {
      cohortRecording: {
        cohortId,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        recordedDate: newDate || undefined,
      },
    })

    if (result) {
      setShowUploadForm(false)
      setSelectedFile(null)
      setNewTitle('')
      setNewDescription('')
      setNewDate('')
      fetchRecordings()
      onRecordingsChange?.()
    } else {
      setError('Upload failed — check the upload indicator for details')
    }

    setUploading(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this recording? This cannot be undone.')) return
    const res = await api.deleteRecording(cohortId, id)
    if (res.error) {
      setError(res.error)
      return
    }
    fetchRecordings()
    onRecordingsChange?.()
  }

  const startEdit = (rec: S3Recording) => {
    setEditingId(rec.id)
    setEditTitle(rec.title)
    setEditDescription(rec.description || '')
    setEditDate(rec.recorded_date ? rec.recorded_date.split('T')[0] : '')
  }

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return
    const res = await api.updateRecording(cohortId, editingId, {
      title: editTitle.trim(),
      description: editDescription.trim() || undefined,
      recorded_date: editDate || undefined,
    })
    if (res.error) {
      setError(res.error)
      return
    }
    setEditingId(null)
    fetchRecordings()
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-primary-500" />
          <h3 className="text-sm font-semibold text-slate-900">
            Uploaded Recordings
          </h3>
          <span className="text-xs text-slate-400">({recordings.length})</span>
        </div>
        <button
          onClick={() => setShowUploadForm(!showUploadForm)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>

      {/* Upload form */}
      {showUploadForm && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-900">Upload Recording</h4>
            <button onClick={() => { setShowUploadForm(false); setSelectedFile(null); setError(null) }} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!selectedFile ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-6 sm:p-8 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('recording-file-input')?.click()}
            >
              <Upload className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600">
                <span className="text-primary-600 font-medium">Choose a video</span> or drag and drop
              </p>
              <p className="text-xs text-slate-400 mt-1">MP4, MOV, WebM — up to 5 GB</p>
              <input
                id="recording-file-input"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-white border border-slate-200 p-3">
                <Film className="h-5 w-5 text-primary-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500">{formatSize(selectedFile.size)}</p>
                </div>
                <button onClick={() => setSelectedFile(null)} className="text-slate-400 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Week 3 Day 1 - Arrays"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date recorded</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => { setShowUploadForm(false); setSelectedFile(null) }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading || !newTitle.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      Upload Recording
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* Recording list */}
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
                    <button onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
                    <button onClick={saveEdit} className="rounded-lg bg-primary-500 px-3 py-1.5 text-xs text-white hover:bg-primary-600">Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <GripVertical className="h-4 w-4 text-slate-300 mt-0.5 shrink-0 cursor-grab hidden sm:block" />
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
                      <span className="text-slate-400">by {rec.uploaded_by}</span>
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
