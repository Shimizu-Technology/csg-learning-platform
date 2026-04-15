import { useEffect, useState, useMemo } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Trash2, Eye, Pencil } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { RichTextEditor } from '../../components/shared/RichTextEditor'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { VideoUploadField } from '../../components/admin/VideoUploadField'

interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  solution: string | null
  metadata: Record<string, unknown>
}

interface Lesson {
  id: number
  title: string
  module_id: number
  lesson_type?: string
  release_day: number
  requires_submission?: boolean
  content_blocks: ContentBlock[]
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'edit' | 'preview'>(searchParams.get('preview') === 'true' ? 'preview' : 'edit')

  const [title, setTitle] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [instructions, setInstructions] = useState('')
  const [solution, setSolution] = useState('')
  const [requiresSubmission, setRequiresSubmission] = useState(false)
  const [s3VideoKey, setS3VideoKey] = useState<string | null>(null)
  const [videoBlockId, setVideoBlockId] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!id) return
    api.getLesson(Number(id)).then((res) => {
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        const data = res.data as { lesson: Lesson }
        const l = data.lesson
        setLesson(l)
        setTitle(l.title || '')
        setRequiresSubmission(l.requires_submission ?? false)

        const videoBlock = l.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (videoBlock) {
          setVideoUrl(videoBlock.video_url || '')
          setVideoBlockId(videoBlock.id)
          setS3VideoKey((videoBlock as any).s3_video_key || null)
        }

        const exerciseBlock = l.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
        if (exerciseBlock) {
          setFilename(exerciseBlock.filename || '')
          setInstructions(exerciseBlock.body || '')
          setSolution(exerciseBlock.solution || '')
        }
      }
      setLoading(false)
    })
  }, [id])

  const handleSave = async () => {
    if (!lesson) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const lessonRes = await api.updateLesson(lesson.id, {
        title: title.trim(),
        requires_submission: requiresSubmission,
      })
      if (lessonRes.error) {
        setSaveError(lessonRes.error)
        setSaving(false)
        return
      }

      const nextPosition = Math.max(0, ...lesson.content_blocks.map(b => b.position)) + 1

      const videoBlock = lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
      if (videoBlock) {
        const vRes = await api.updateContentBlock(videoBlock.id, {
          title: title.trim(),
          video_url: videoUrl.trim() || null,
        })
        if (vRes.error) { setSaveError(vRes.error); setSaving(false); return }
      } else if (videoUrl.trim() || s3VideoKey) {
        const vRes = await api.createContentBlock(lesson.id, {
          block_type: 'video',
          position: nextPosition,
          title: title.trim(),
          video_url: videoUrl.trim() || undefined,
        })
        if (vRes.error) { setSaveError(vRes.error); setSaving(false); return }
        if (vRes.data?.content_block) setVideoBlockId(vRes.data.content_block.id)
      }

      const exerciseBlock = lesson.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
      if (exerciseBlock) {
        const eRes = await api.updateContentBlock(exerciseBlock.id, {
          title: title.trim(),
          body: instructions.trim() || null,
          solution: solution.trim() || null,
          filename: filename.trim() || null,
        })
        if (eRes.error) { setSaveError(eRes.error); setSaving(false); return }
      } else if (instructions.trim() || filename.trim()) {
        const eRes = await api.createContentBlock(lesson.id, {
          block_type: 'exercise',
          position: nextPosition + 1,
          title: title.trim(),
          body: instructions.trim() || undefined,
          solution: solution.trim() || undefined,
          filename: filename.trim() || undefined,
        })
        if (eRes.error) { setSaveError(eRes.error); setSaving(false); return }
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)

      const refreshRes = await api.getLesson(lesson.id)
      if (refreshRes.data) {
        const data = refreshRes.data as { lesson: Lesson }
        setLesson(data.lesson)
        const refreshedVideo = data.lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (refreshedVideo) {
          setVideoBlockId(refreshedVideo.id)
          setS3VideoKey((refreshedVideo as any).s3_video_key || null)
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!lesson) return
    setDeleting(true)
    const res = await api.deleteLesson(lesson.id)
    if (res.error) {
      setSaveError(res.error)
      setDeleting(false)
    } else {
      navigate('/admin/content')
    }
  }

  const previewBlocks = useMemo(() => {
    const blocks: ContentBlock[] = []
    if (videoUrl.trim() || s3VideoKey) {
      blocks.push({
        id: videoBlockId || -1,
        block_type: 'video',
        position: 0,
        title: title || null,
        body: null,
        video_url: videoUrl.trim() || null,
        filename: null,
        solution: null,
        metadata: {},
        ...(s3VideoKey ? { s3_video_key: s3VideoKey } : {}),
      } as ContentBlock)
    }
    if (instructions.trim() || filename.trim()) {
      blocks.push({
        id: -2,
        block_type: 'exercise',
        position: 1,
        title: title || null,
        body: instructions.trim() || null,
        video_url: null,
        filename: filename.trim() || null,
        solution: null,
        metadata: {},
      })
    }
    return blocks
  }, [title, videoUrl, instructions, filename, s3VideoKey, videoBlockId])

  if (loading) return <LoadingSpinner message="Loading exercise..." />
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/admin/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <p className="text-red-600">{error}</p>
      </div>
    )
  }
  if (!lesson) return null

  const week = Math.floor(lesson.release_day / 7) + 1
  const dayIdx = lesson.release_day % 7

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div>
        <Link to="/admin/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Edit Exercise</h1>
            <p className="text-sm text-slate-500 mt-1">
              Week {week}, {DAY_NAMES[dayIdx] || `Day ${dayIdx}`} · Release day {lesson.release_day}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Edit / Preview toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${
                  mode === 'edit'
                    ? 'bg-slate-100 text-slate-800'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${
                  mode === 'preview'
                    ? 'bg-slate-100 text-slate-800'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Student Preview
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
      )}
      {saveSuccess && (
        <div className="rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">Saved successfully!</div>
      )}

      {mode === 'preview' ? (
        /* ---- Student Preview ---- */
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            This is how students will see this exercise. Content shown is based on your current edits (save first to persist changes).
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-6">
            <h1 className="text-xl font-bold text-slate-900">{title || 'Untitled Exercise'}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <span className="capitalize">Exercise</span>
              <span>· {previewBlocks.length} blocks</span>
            </div>
          </div>

          <div className="space-y-4">
            {previewBlocks.map((block) => (
              <ContentBlockRenderer
                key={block.id}
                block={block as any}
                isStaff={false}
                requiresSubmission={requiresSubmission}
              />
            ))}
          </div>

          {previewBlocks.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
              No content to preview. Add a video URL or instructions to see the student view.
            </div>
          )}
        </div>
      ) : (
        /* ---- Edit Mode ---- */
        <>
          {/* Details card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <VideoUploadField
                  contentBlockId={videoBlockId}
                  videoUrl={videoUrl}
                  onVideoUrlChange={setVideoUrl}
                  s3VideoKey={s3VideoKey}
                  onS3VideoUploaded={(data) => setS3VideoKey(data.s3_video_key)}
                  onS3VideoRemoved={() => setS3VideoKey(null)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Filename</label>
                <input
                  type="text"
                  value={filename}
                  onChange={e => setFilename(e.target.value)}
                  placeholder="e.g. 111.rb"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">Leave blank if no submission</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">&nbsp;</label>
                <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors h-[42px]">
                  <input
                    type="checkbox"
                    checked={requiresSubmission}
                    onChange={e => setRequiresSubmission(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-slate-700">Requires submission</span>
                </label>
              </div>
            </div>
          </div>

          {/* Instructions — WYSIWYG editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <RichTextEditor
              value={instructions}
              onChange={setInstructions}
              label="Instructions"
              placeholder="Write exercise instructions here..."
              height={400}
            />
          </div>

          {/* Solution — Code editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-end justify-between mb-1.5">
              <div>
                <span className="text-sm font-semibold text-slate-700">Solution</span>
                <span className="text-sm font-normal text-slate-400 ml-1">(staff only)</span>
              </div>
            </div>
            <CodeEditor
              value={solution}
              onChange={setSolution}
              language={detectLanguage(filename)}
              minHeight={500}
            />
          </div>

          {/* Bottom actions */}
          <div className="flex items-center justify-between">
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Delete this exercise?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Exercise
                </button>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
