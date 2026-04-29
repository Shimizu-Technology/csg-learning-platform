import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Trash2, Eye, Pencil } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { RichTextEditor } from '../../components/shared/RichTextEditor'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { VideoUploadField } from '../../components/admin/VideoUploadField'
import { AdminVideoPreview } from '../../components/admin/AdminVideoPreview'
import { CodeRunnerSettings } from '../../components/admin/CodeRunnerSettings'
import { useUpload } from '../../contexts/UploadContext'
import { useToast } from '../../contexts/ToastContext'
import {
  buildSubmissionConfigWithRunner,
  codeRunnerLanguageFromEditor,
  normalizeCodeRunnerConfig,
  type CodeRunnerConfig,
} from '../../lib/codeRunner'

interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  submission_type?: string | null
  submission_config?: Record<string, unknown>
  solution: string | null
  metadata: Record<string, unknown>
  s3_video_key?: string | null
}

interface Lesson {
  id: number
  title: string
  module_id: number
  lesson_type?: string
  release_day: number
  requires_submission?: boolean
  submission_type?: string
  content_blocks: ContentBlock[]
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
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
  const [submissionType, setSubmissionType] = useState('manual_complete')
  const [runnerConfig, setRunnerConfig] = useState<CodeRunnerConfig>({
    enabled: false,
    language: 'ruby',
  })
  const [s3VideoKey, setS3VideoKey] = useState<string | null>(null)
  const [videoBlockId, setVideoBlockId] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Upload context — used to prefer in-flight upload's s3_key over a stale (null) fetch result.
  const { uploads } = useUpload()
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // Helper: returns the s3_key from the API response, but falls back to any in-flight
  // upload's s3_key for the same content block (handles the case where the user navigates
  // away and back while an upload is still in progress and hasn't yet PATCHed the block).
  const resolveS3Key = useCallback((blockId: number, fetchedKey: string | null): string | null => {
    if (fetchedKey) return fetchedKey
    const live = uploadsRef.current.find(u => u.contentBlockId === blockId && u.s3Key && u.status !== 'error')
    return live?.s3Key || null
  }, [])

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
        const videoBlock = l.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (videoBlock) {
          setVideoUrl(videoBlock.video_url || '')
          setVideoBlockId(videoBlock.id)
          setS3VideoKey(resolveS3Key(videoBlock.id, videoBlock.s3_video_key ?? null))
        }

        const exerciseBlock = l.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
        if (exerciseBlock) {
          setFilename(exerciseBlock.filename || '')
          setInstructions(exerciseBlock.body || '')
          setSolution(exerciseBlock.solution || '')
          setSubmissionType(exerciseBlock.submission_type || l.submission_type || (l.requires_submission ? 'text_submission' : 'manual_complete'))
          setRunnerConfig(normalizeCodeRunnerConfig(
            exerciseBlock.submission_config,
            codeRunnerLanguageFromEditor(detectLanguage(exerciseBlock.filename)) || 'ruby'
          ))
        }
      }
      setLoading(false)
    })
  }, [id, resolveS3Key])

  // Stable callbacks so VideoUploadField's effect deps don't churn every render.
  const handleS3VideoUploaded = useCallback(
    (data: { s3_video_key: string }) => setS3VideoKey(data.s3_video_key),
    []
  )
  const handleS3VideoRemoved = useCallback(() => setS3VideoKey(null), [])

  const handleSave = async () => {
    if (!lesson) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const lessonRes = await api.updateLesson(lesson.id, {
        title: title.trim(),
        requires_submission: submissionType !== 'manual_complete',
      })
      if (lessonRes.error) {
        setSaveError(lessonRes.error)
        toast.error(lessonRes.error)
        setSaving(false)
        return
      }

      const nextPosition = Math.max(0, ...lesson.content_blocks.map(b => b.position)) + 1

      const videoBlock = lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
      if (videoBlock) {
        // Don't include s3_video_key if there's an in-flight upload for this block — the
        // UploadContext will PATCH the key when the upload completes; sending null here
        // could otherwise clobber a value that's about to be saved.
        const inFlight = uploadsRef.current.find(
          u => u.contentBlockId === videoBlock.id && u.status !== 'done' && u.status !== 'error'
        )
        const updatePayload: { title: string; video_url: string | null; s3_video_key?: string | null } = {
          title: title.trim(),
          video_url: videoUrl.trim() || null,
        }
        if (!inFlight) updatePayload.s3_video_key = s3VideoKey
        const vRes = await api.updateContentBlock(videoBlock.id, updatePayload)
        if (vRes.error) { setSaveError(vRes.error); toast.error(vRes.error); setSaving(false); return }
      } else if (videoUrl.trim() || s3VideoKey) {
        const vRes = await api.createContentBlock(lesson.id, {
          block_type: 'video',
          position: nextPosition,
          title: title.trim(),
          video_url: videoUrl.trim() || undefined,
          s3_video_key: s3VideoKey || undefined,
        })
        if (vRes.error) { setSaveError(vRes.error); toast.error(vRes.error); setSaving(false); return }
        if (vRes.data?.content_block) setVideoBlockId(vRes.data.content_block.id)
      }

      const exerciseBlock = lesson.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
      const submissionConfig = buildSubmissionConfigWithRunner(
        exerciseBlock?.submission_config,
        submissionType === 'text_submission' ? runnerConfig : { ...runnerConfig, enabled: false }
      )
      if (exerciseBlock) {
        const eRes = await api.updateContentBlock(exerciseBlock.id, {
          title: title.trim(),
          body: instructions.trim() || null,
          solution: solution.trim() || null,
          filename: filename.trim() || null,
          submission_type: submissionType,
          submission_config: submissionConfig,
        })
        if (eRes.error) { setSaveError(eRes.error); toast.error(eRes.error); setSaving(false); return }
      } else if (instructions.trim() || filename.trim()) {
        const eRes = await api.createContentBlock(lesson.id, {
          block_type: 'exercise',
          position: nextPosition + 1,
          title: title.trim(),
          body: instructions.trim() || undefined,
          solution: solution.trim() || undefined,
          filename: filename.trim() || undefined,
          submission_type: submissionType,
          submission_config: submissionConfig,
        })
        if (eRes.error) { setSaveError(eRes.error); toast.error(eRes.error); setSaving(false); return }
      }

      setSaveSuccess(true)
      toast.success('Exercise saved successfully')
      setTimeout(() => setSaveSuccess(false), 3000)

      const refreshRes = await api.getLesson(lesson.id)
      if (refreshRes.data) {
        const data = refreshRes.data as { lesson: Lesson }
        setLesson(data.lesson)
        const refreshedVideo = data.lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (refreshedVideo) {
          setVideoBlockId(refreshedVideo.id)
          setS3VideoKey(resolveS3Key(refreshedVideo.id, refreshedVideo.s3_video_key ?? null))
        }
        const refreshedExercise = data.lesson.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
        if (refreshedExercise?.submission_type) setSubmissionType(refreshedExercise.submission_type)
        if (refreshedExercise) {
          setRunnerConfig(normalizeCodeRunnerConfig(
            refreshedExercise.submission_config,
            codeRunnerLanguageFromEditor(detectLanguage(refreshedExercise.filename)) || 'ruby'
          ))
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      setSaveError(message)
      toast.error(message)
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
      toast.error(res.error)
      setDeleting(false)
    } else {
      toast.success('Exercise deleted')
      navigate('/admin/content')
    }
  }

  const handleSubmissionTypeChange = (nextType: string) => {
    setSubmissionType(nextType)
    if (nextType !== 'text_submission') {
      setRunnerConfig((current) => ({ ...current, enabled: false }))
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
        submission_type: submissionType,
        submission_config: buildSubmissionConfigWithRunner(
          undefined,
          submissionType === 'text_submission' ? runnerConfig : { ...runnerConfig, enabled: false }
        ),
        solution: null,
        metadata: {},
      })
    }
    return blocks
  }, [title, videoUrl, instructions, filename, s3VideoKey, videoBlockId, submissionType, runnerConfig])

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
              Week {week}, {DAY_NAMES[dayIdx] || `Day ${dayIdx + 1}`} · Day {lesson.release_day + 1} in the release calendar
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)]">
              <div>
                <VideoUploadField
                  contentBlockId={videoBlockId}
                  lessonId={lesson?.id}
                  contextLabel={title ? `Exercise: ${title}` : 'Exercise'}
                  videoUrl={videoUrl}
                  onVideoUrlChange={setVideoUrl}
                  s3VideoKey={s3VideoKey}
                  onS3VideoUploaded={handleS3VideoUploaded}
                  onS3VideoRemoved={handleS3VideoRemoved}
                />
              </div>
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
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
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Submission Type</label>
                    <select
                      value={submissionType}
                      onChange={e => handleSubmissionTypeChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="manual_complete">Practice only</option>
                      <option value="text_submission">Text/code submission</option>
                      <option value="prework_github_sync">GitHub filename sync</option>
                      <option value="repo_url_submission">Repository submission</option>
                      <option value="repo_and_live_url_submission">Repo + live URL submission</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  {submissionType === 'manual_complete' && 'Students mark this complete themselves. This is ideal for daily practice.'}
                  {submissionType === 'text_submission' && 'Students submit code/text directly in the platform for grading.'}
                  {submissionType === 'prework_github_sync' && 'Use this only for the filename-based prework GitHub sync flow.'}
                  {submissionType === 'repo_url_submission' && 'Students submit a repository URL and optional notes. Extra Git details stay available only when needed.'}
                  {submissionType === 'repo_and_live_url_submission' && 'Students submit a repository URL and a live deployed URL. Notes stay optional.'}
                </div>

                {submissionType === 'text_submission' && (
                  <CodeRunnerSettings
                    value={runnerConfig}
                    onChange={setRunnerConfig}
                    compact
                  />
                )}
              </div>
            </div>

            <AdminVideoPreview
              contentBlockId={videoBlockId}
              s3VideoKey={s3VideoKey}
              videoUrl={videoUrl}
              title={title}
            />
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
