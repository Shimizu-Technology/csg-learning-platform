import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Trash2, Eye, Pencil, Plus, Target, X, ClipboardCheck, ListChecks } from 'lucide-react'
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
import { LearningObjectivesPanel } from '../../components/shared/LearningObjectivesPanel'
import type { LearningObjective, LessonObjective, Rubric } from '../../types/api'

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
  s3_video_uploaded_at?: string | null
  s3_video_uploaded_by?: string | null
  rubric?: Rubric | null
  knowledge_check?: import('../../types/api').KnowledgeCheck | null
}

interface Lesson {
  id: number
  curriculum_id: number
  title: string
  module_id: number
  lesson_type?: string
  release_day: number
  requires_submission?: boolean
  submission_type?: string
  content_blocks: ContentBlock[]
  objectives: LessonObjective[]
}

type ObjectiveAlignmentDraft = { learning_objective_id: number; content_block_id: number | null }

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [objectiveCatalog, setObjectiveCatalog] = useState<LearningObjective[]>([])
  const [objectiveAlignments, setObjectiveAlignments] = useState<ObjectiveAlignmentDraft[]>([])
  const [creatingObjective, setCreatingObjective] = useState(false)
  const [objectiveDraft, setObjectiveDraft] = useState({ code: '', title: '', description: '', success_criteria: '' })
  const [rubricCatalog, setRubricCatalog] = useState<Rubric[]>([])
  const [selectedRubricId, setSelectedRubricId] = useState<number | null>(null)
  const [creatingRubric, setCreatingRubric] = useState(false)
  const [rubricDraft, setRubricDraft] = useState({ title: '', description: '', criteria: [{ title: '', description: '' }, { title: '', description: '' }] })
  const [checkEnabled, setCheckEnabled] = useState(false)
  const [checkBlockId, setCheckBlockId] = useState<number | null>(null)
  const [checkTitle, setCheckTitle] = useState('Quick check')
  const [checkPrompt, setCheckPrompt] = useState('')
  const [checkOptions, setCheckOptions] = useState(['', ''])
  const [checkCorrectOption, setCheckCorrectOption] = useState(0)
  const [checkExplanation, setCheckExplanation] = useState('')
  const [checkObjectiveId, setCheckObjectiveId] = useState<number | null>(null)
  const [checkAttemptCount, setCheckAttemptCount] = useState(0)
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
  const [s3VideoUploadedAt, setS3VideoUploadedAt] = useState<string | null>(null)
  const [s3VideoUploadedBy, setS3VideoUploadedBy] = useState<string | null>(null)
  const [videoBlockId, setVideoBlockId] = useState<number | null>(null)
  const [pendingVideoUploadId, setPendingVideoUploadId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Upload context — used to prefer in-flight upload's s3_key over a stale (null) fetch result.
  const { uploads, completeDeferredUpload } = useUpload()
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // Helper: returns the s3_key from the API response, but falls back to any in-flight
  // upload's s3_key for the same content block (handles the case where the user navigates
  // away and back while an upload is still in progress and hasn't yet PATCHed the block).
  const resolveS3Key = useCallback((blockId: number, fetchedKey: string | null): string | null => {
    const live = uploadsRef.current.find(u => u.contentBlockId === blockId && u.deferPersistence && u.s3Key && u.status !== 'error')
    if (live?.s3Key) return live.s3Key
    if (fetchedKey) return fetchedKey
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
        setObjectiveAlignments((l.objectives || []).map((objective) => ({ learning_objective_id: objective.id, content_block_id: objective.content_block_id })))
        void api.getLearningObjectives(l.curriculum_id).then((objectiveRes) => {
          if (objectiveRes.data) setObjectiveCatalog(objectiveRes.data.learning_objectives)
        })
        void api.getRubrics(l.curriculum_id).then((rubricRes) => {
          if (rubricRes.data) setRubricCatalog(rubricRes.data.rubrics)
        })
        setTitle(l.title || '')
        const videoBlock = l.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (videoBlock) {
          setVideoUrl(videoBlock.video_url || '')
          setVideoBlockId(videoBlock.id)
          setS3VideoKey(resolveS3Key(videoBlock.id, videoBlock.s3_video_key ?? null))
          setS3VideoUploadedAt(videoBlock.s3_video_uploaded_at ?? null)
          setS3VideoUploadedBy(videoBlock.s3_video_uploaded_by ?? null)
        }

        const exerciseBlock = l.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
        if (exerciseBlock) {
          setSelectedRubricId(exerciseBlock.rubric?.id || null)
          setFilename(exerciseBlock.filename || '')
          setInstructions(exerciseBlock.body || '')
          setSolution(exerciseBlock.solution || '')
          setSubmissionType(exerciseBlock.submission_type || l.submission_type || (l.requires_submission ? 'text_submission' : 'manual_complete'))
          setRunnerConfig(normalizeCodeRunnerConfig(
            exerciseBlock.submission_config,
            codeRunnerLanguageFromEditor(detectLanguage(exerciseBlock.filename)) || 'ruby'
          ))
        }
        const checkBlock = l.content_blocks.find(b => b.knowledge_check)
        if (checkBlock?.knowledge_check) {
          setCheckEnabled(true)
          setCheckBlockId(checkBlock.id)
          setCheckTitle(checkBlock.title || 'Quick check')
          setCheckPrompt(checkBlock.knowledge_check.prompt)
          setCheckOptions(checkBlock.knowledge_check.options)
          setCheckCorrectOption(checkBlock.knowledge_check.correct_option ?? 0)
          setCheckExplanation(checkBlock.knowledge_check.explanation || checkBlock.knowledge_check.latest_attempt?.explanation || '')
          setCheckObjectiveId(checkBlock.knowledge_check.learning_objective_id || null)
          setCheckAttemptCount(checkBlock.knowledge_check.attempt_count)
        }
      }
      setLoading(false)
    })
  }, [id, resolveS3Key])

  // Stable callbacks so VideoUploadField's effect deps don't churn every render.
  const handleS3VideoUploaded = useCallback(
    (data: { s3_video_key: string }) => {
      setS3VideoKey(data.s3_video_key)
      setS3VideoUploadedAt(null)
      setS3VideoUploadedBy(null)
    },
    []
  )
  const handleS3VideoRemoved = useCallback(() => {
    setS3VideoKey(null)
    setS3VideoUploadedAt(null)
    setS3VideoUploadedBy(null)
    setPendingVideoUploadId(null)
  }, [])

  const handleSave = async () => {
    if (!lesson) return
    const cleanCheckOptions = checkOptions.map((option) => option.trim())
    if (checkEnabled && (!checkPrompt.trim() || cleanCheckOptions.length < 2 || cleanCheckOptions.some((option) => !option) || !checkExplanation.trim() || checkCorrectOption >= cleanCheckOptions.length)) {
      const message = 'Add a question, at least two choices, a valid correct answer, and an explanation for the retrieval check.'
      setSaveError(message)
      toast.error(message)
      return
    }
    const lessonEditorPath = `/admin/lessons/${lesson.id}/edit`
    const activeVideoUpload = uploadsRef.current.find((upload) => (
      upload.status !== 'error' && (
        upload.id === pendingVideoUploadId ||
        (upload.deferPersistence && (upload.contentBlockId === videoBlockId || upload.linkTo === lessonEditorPath))
      )
    ))
    if (activeVideoUpload && activeVideoUpload.status !== 'waiting' && activeVideoUpload.status !== 'done') {
      const message = 'Wait for the video upload to finish before saving this lesson.'
      setSaveError(message)
      toast.error(message)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const videoBlock = lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
      const exerciseBlock = lesson.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
      const submissionConfig = buildSubmissionConfigWithRunner(
        exerciseBlock?.submission_config,
        submissionType === 'text_submission' ? runnerConfig : { ...runnerConfig, enabled: false }
      )
      const inFlightVideo = videoBlock && uploadsRef.current.some(
        upload => upload.contentBlockId === videoBlock.id && ['presigning', 'uploading', 'saving'].includes(upload.status)
      )
      const video = videoBlock || videoUrl.trim() || s3VideoKey ? {
        ...(videoBlock ? { id: videoBlock.id } : {}),
        title: title.trim(),
        video_url: videoUrl.trim() || null,
        ...(!inFlightVideo ? { s3_video_key: s3VideoKey } : {}),
      } : undefined
      const exercise = exerciseBlock || instructions.trim() || filename.trim() ? {
        ...(exerciseBlock ? { id: exerciseBlock.id } : {}),
        title: title.trim(),
        body: instructions.trim() || null,
        solution: solution.trim() || null,
        filename: filename.trim() || null,
        submission_type: submissionType,
        submission_config: submissionConfig,
        rubric_id: selectedRubricId,
      } : undefined

      const response = await api.updateLessonEditor(lesson.id, {
        title: title.trim(),
        requires_submission: submissionType !== 'manual_complete',
        video,
        exercise,
        ...(checkEnabled || checkBlockId ? { retrieval_check: {
          enabled: checkEnabled,
          ...(checkBlockId ? { content_block_id: checkBlockId } : {}),
          title: checkTitle.trim() || 'Quick check',
          prompt: checkPrompt.trim(),
          options: cleanCheckOptions,
          correct_option: checkCorrectOption,
          explanation: checkExplanation.trim(),
          learning_objective_id: checkObjectiveId,
        } } : {}),
        alignments: objectiveAlignments,
      })
      if (response.error || !response.data) {
        const message = response.error || 'Exercise could not be saved.'
        setSaveError(message)
        toast.error(message)
        return
      }

      const data = response.data as { lesson: Lesson }
      if (data.lesson) {
        setLesson(data.lesson)
        setObjectiveAlignments((data.lesson.objectives || []).map((objective) => ({ learning_objective_id: objective.id, content_block_id: objective.content_block_id })))
        const refreshedVideo = data.lesson.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (refreshedVideo) {
          setVideoBlockId(refreshedVideo.id)
          setS3VideoKey(resolveS3Key(refreshedVideo.id, refreshedVideo.s3_video_key ?? null))
          setS3VideoUploadedAt(refreshedVideo.s3_video_uploaded_at ?? null)
          setS3VideoUploadedBy(refreshedVideo.s3_video_uploaded_by ?? null)
        }
        const refreshedExercise = data.lesson.content_blocks.find(b => b.block_type === 'exercise' || b.block_type === 'code_challenge')
        if (refreshedExercise?.submission_type) setSubmissionType(refreshedExercise.submission_type)
        if (refreshedExercise) {
          setSelectedRubricId(refreshedExercise.rubric?.id || null)
          setRunnerConfig(normalizeCodeRunnerConfig(
            refreshedExercise.submission_config,
            codeRunnerLanguageFromEditor(detectLanguage(refreshedExercise.filename)) || 'ruby'
          ))
        }
        const refreshedCheckBlock = data.lesson.content_blocks.find(b => b.knowledge_check)
        if (refreshedCheckBlock?.knowledge_check) {
          setCheckEnabled(true)
          setCheckBlockId(refreshedCheckBlock.id)
          setCheckTitle(refreshedCheckBlock.title || 'Quick check')
          setCheckPrompt(refreshedCheckBlock.knowledge_check.prompt)
          setCheckOptions(refreshedCheckBlock.knowledge_check.options)
          setCheckCorrectOption(refreshedCheckBlock.knowledge_check.correct_option ?? 0)
          setCheckExplanation(refreshedCheckBlock.knowledge_check.explanation || '')
          setCheckObjectiveId(refreshedCheckBlock.knowledge_check.learning_objective_id || null)
          setCheckAttemptCount(refreshedCheckBlock.knowledge_check.attempt_count)
        } else {
          setCheckEnabled(false)
          setCheckBlockId(null)
          setCheckAttemptCount(0)
        }
      }
      if (activeVideoUpload) {
        completeDeferredUpload(activeVideoUpload.id)
        setPendingVideoUploadId(null)
      }
      setSaveSuccess(true)
      toast.success('Exercise saved successfully')
      setTimeout(() => setSaveSuccess(false), 3000)
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

  const handleCreateObjective = async () => {
    if (!lesson || !objectiveDraft.code.trim() || !objectiveDraft.title.trim() || !objectiveDraft.success_criteria.trim()) {
      setSaveError('Objective code, title, and success criteria are required.')
      return
    }
    setCreatingObjective(true)
    setSaveError(null)
    try {
      const response = await api.createLearningObjective({
        curriculum_id: lesson.curriculum_id,
        code: objectiveDraft.code,
        title: objectiveDraft.title,
        description: objectiveDraft.description || undefined,
        success_criteria: objectiveDraft.success_criteria,
        position: objectiveCatalog.length,
        lesson_id: lesson.id,
      })
      if (response.error || !response.data) {
        setSaveError(response.error || 'Could not create the objective.')
        return
      }
      const objective = response.data.learning_objective
      setObjectiveCatalog((current) => [...current, objective])
      const nextAlignments = [...objectiveAlignments, { learning_objective_id: objective.id, content_block_id: null }]
      setObjectiveAlignments(nextAlignments)
      setObjectiveDraft({ code: '', title: '', description: '', success_criteria: '' })
      toast.success('Objective created and added to this lesson')
    } finally {
      setCreatingObjective(false)
    }
  }

  const handleCreateRubric = async () => {
    if (!lesson || !rubricDraft.title.trim()) return
    const criteria = rubricDraft.criteria
      .map((criterion) => ({ title: criterion.title.trim(), description: criterion.description.trim() }))
      .filter((criterion) => criterion.title && criterion.description)
    if (!criteria.length) {
      setSaveError('Add at least one rubric criterion with a title and description.')
      return
    }
    setCreatingRubric(true)
    setSaveError(null)
    try {
      const response = await api.createRubric({
        curriculum_id: lesson.curriculum_id,
        title: rubricDraft.title.trim(),
        description: rubricDraft.description.trim() || undefined,
        criteria,
      })
      if (response.error || !response.data) {
        setSaveError(response.error || 'Could not create the rubric.')
        return
      }
      setRubricCatalog((current) => [...current, response.data!.rubric])
      setSelectedRubricId(response.data.rubric.id)
      setRubricDraft({ title: '', description: '', criteria: [{ title: '', description: '' }, { title: '', description: '' }] })
      toast.success('Rubric created and selected. Save the lesson to attach it.')
    } finally {
      setCreatingRubric(false)
    }
  }

  const previewObjectives: LessonObjective[] = objectiveAlignments.flatMap((alignment, index) => {
    const objective = objectiveCatalog.find((item) => item.id === alignment.learning_objective_id)
    if (!objective) return []
    const block = lesson?.content_blocks.find((item) => item.id === alignment.content_block_id)
    return [{
      alignment_id: -(index + 1),
      id: objective.id,
      code: objective.code,
      title: objective.title,
      description: objective.description,
      success_criteria: objective.success_criteria,
      active: objective.active,
      content_block_id: alignment.content_block_id,
      content_block_title: block?.title || null,
    }]
  })

  const availableObjectives = objectiveCatalog.filter((objective) => !objectiveAlignments.some((alignment) => alignment.learning_objective_id === objective.id))

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
    if (checkEnabled && checkPrompt.trim()) {
      blocks.push({
        id: -3,
        block_type: 'checkpoint',
        position: blocks.length,
        title: checkTitle.trim() || 'Quick check',
        body: null,
        video_url: null,
        filename: null,
        solution: null,
        metadata: {},
        knowledge_check: {
          id: -3,
          prompt: checkPrompt.trim(),
          options: checkOptions.map((option) => option.trim()),
          correct_option: checkCorrectOption,
          explanation: checkExplanation.trim(),
          learning_objective_id: checkObjectiveId,
          objective_code: objectiveCatalog.find((objective) => objective.id === checkObjectiveId)?.code || null,
          attempt_count: 0,
          latest_attempt: null,
        },
      })
    }
    return blocks
  }, [title, videoUrl, instructions, filename, s3VideoKey, videoBlockId, submissionType, runnerConfig, checkEnabled, checkPrompt, checkTitle, checkOptions, checkCorrectOption, checkExplanation, checkObjectiveId, objectiveCatalog])

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
    <div className="app-page max-w-5xl">
      {/* Header */}
      <div>
        <Link to="/admin/content" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="app-eyebrow">Curriculum studio</p>
            <h1 className="app-title mt-2">Edit exercise</h1>
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

          <LearningObjectivesPanel objectives={previewObjectives} preview />

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
                  s3VideoUploadedAt={s3VideoUploadedAt}
                  s3VideoUploadedBy={s3VideoUploadedBy}
                  onS3VideoUploaded={handleS3VideoUploaded}
                  onS3VideoRemoved={handleS3VideoRemoved}
                  onUploadStarted={setPendingVideoUploadId}
                  deferPersistence
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


          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600"><Target className="h-5 w-5" /></span>
                <div>
                  <p className="app-eyebrow">Learning design</p>
                  <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Objectives and success criteria</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Tell students what they are building toward before they begin. Reuse objectives across lessons and attach each one to the whole lesson or a specific block.</p>
                </div>
              </div>
              {availableObjectives.length > 0 && (
                <select
                  aria-label="Add an existing objective"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return
                    setObjectiveAlignments((current) => [...current, { learning_objective_id: Number(event.target.value), content_block_id: null }])
                  }}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Add existing objective…</option>
                  {availableObjectives.map((objective) => <option key={objective.id} value={objective.id}>{objective.code} · {objective.title}</option>)}
                </select>
              )}
            </div>

            <div className="mt-5 space-y-3">
              {objectiveAlignments.map((alignment) => {
                const objective = objectiveCatalog.find((item) => item.id === alignment.learning_objective_id)
                if (!objective) return null
                return (
                  <div key={objective.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg bg-white px-2 py-1 font-mono text-[11px] font-bold text-slate-600 shadow-sm">{objective.code}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-extrabold text-slate-950">{objective.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{objective.success_criteria}</p>
                        <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Applies to
                          <select
                            value={alignment.content_block_id || ''}
                            onChange={(event) => setObjectiveAlignments((current) => current.map((item) => item.learning_objective_id === objective.id ? { ...item, content_block_id: event.target.value ? Number(event.target.value) : null } : item))}
                            className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 sm:max-w-md"
                          >
                            <option value="">Entire lesson</option>
                            {lesson.content_blocks.map((block) => <option key={block.id} value={block.id}>{block.title || `${block.block_type} block`}</option>)}
                          </select>
                        </label>
                      </div>
                      <button type="button" aria-label={`Remove ${objective.title}`} onClick={() => setObjectiveAlignments((current) => current.filter((item) => item.learning_objective_id !== objective.id))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                )
              })}
              {!objectiveAlignments.length && <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-7 text-center text-sm text-slate-500">No objectives yet. Create the first one below or reuse one from this curriculum.</div>}
            </div>

            <div className="mt-5 rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Objective code<input value={objectiveDraft.code} onChange={(event) => setObjectiveDraft((current) => ({ ...current, code: event.target.value }))} placeholder="TERM.1" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Student-facing title<input value={objectiveDraft.title} onChange={(event) => setObjectiveDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Navigate folders from the terminal" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">Context (optional)<textarea value={objectiveDraft.description} onChange={(event) => setObjectiveDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What concept or skill this objective covers." rows={2} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:col-span-2">Success criteria<textarea value={objectiveDraft.success_criteria} onChange={(event) => setObjectiveDraft((current) => ({ ...current, success_criteria: event.target.value }))} placeholder="I can move into a requested folder, go back one level, and confirm where I am." rows={3} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
              </div>
              <button type="button" disabled={creatingObjective} onClick={() => void handleCreateObjective()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"><Plus className="h-4 w-4" />{creatingObjective ? 'Creating…' : 'Create and add objective'}</button>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ClipboardCheck className="h-5 w-5" /></span>
              <div>
                <p className="app-eyebrow">Evidence and feedback</p>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Student-visible rubric</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">Show the criteria before submission, then return a rating and focused feedback for every criterion.</p>
              </div>
            </div>
            <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-600">Attached rubric
              <select value={selectedRubricId || ''} onChange={(event) => setSelectedRubricId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">No rubric</option>
                {rubricCatalog.filter((rubric) => rubric.active !== false).map((rubric) => <option key={rubric.id} value={rubric.id}>{rubric.title} · {rubric.criteria.length} criteria</option>)}
              </select>
            </label>
            {selectedRubricId && rubricCatalog.find((rubric) => rubric.id === selectedRubricId) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {rubricCatalog.find((rubric) => rubric.id === selectedRubricId)!.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><p className="text-sm font-bold text-slate-900">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-slate-600">{criterion.description}</p></div>)}
              </div>
            )}
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-bold text-slate-900">Create a reusable rubric</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Rubric title<input value={rubricDraft.title} onChange={(event) => setRubricDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Project quality" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Purpose (optional)<input value={rubricDraft.description} onChange={(event) => setRubricDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this rubric evaluates" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500" /></label>
              </div>
              <div className="mt-3 space-y-3">
                {rubricDraft.criteria.map((criterion, index) => <div key={index} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[0.7fr_1.3fr_auto]"><input aria-label={`Criterion ${index + 1} title`} value={criterion.title} onChange={(event) => setRubricDraft((current) => ({ ...current, criteria: current.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} placeholder="Criterion title" className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /><input aria-label={`Criterion ${index + 1} description`} value={criterion.description} onChange={(event) => setRubricDraft((current) => ({ ...current, criteria: current.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} placeholder="What meeting this criterion looks like" className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /><button type="button" aria-label={`Remove criterion ${index + 1}`} disabled={rubricDraft.criteria.length === 1} onClick={() => setRubricDraft((current) => ({ ...current, criteria: current.criteria.filter((_, itemIndex) => itemIndex !== index) }))} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"><X className="h-4 w-4" /></button></div>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setRubricDraft((current) => ({ ...current, criteria: [...current.criteria, { title: '', description: '' }] }))} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"><Plus className="h-4 w-4" />Add criterion</button><button type="button" disabled={creatingRubric} onClick={() => void handleCreateRubric()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"><ClipboardCheck className="h-4 w-4" />{creatingRubric ? 'Creating…' : 'Create and select rubric'}</button></div>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><ListChecks className="h-5 w-5" /></span>
                <div>
                  <p className="app-eyebrow">Retrieval practice</p>
                  <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Quick recall check</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Use one low-stakes question to help students retrieve a foundational idea. They receive an explanation immediately and can retry.</p>
                </div>
              </div>
              <label className="inline-flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700"><input type="checkbox" checked={checkEnabled} disabled={checkAttemptCount > 0} onChange={(event) => setCheckEnabled(event.target.checked)} className="h-4 w-4 accent-primary-600" />Include check</label>
            </div>
            {checkAttemptCount > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{checkAttemptCount} student {checkAttemptCount === 1 ? 'attempt is' : 'attempts are'} recorded. The question is locked to preserve that evidence; create a new check if the standard changes.</div>}
            {checkEnabled && <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Check title<input value={checkTitle} disabled={checkAttemptCount > 0} onChange={(event) => setCheckTitle(event.target.value)} placeholder="Quick check" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100" /></label>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Aligned objective<select value={checkObjectiveId || ''} disabled={checkAttemptCount > 0} onChange={(event) => setCheckObjectiveId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal disabled:bg-slate-100"><option value="">No specific objective</option>{objectiveCatalog.filter((objective) => objective.active).map((objective) => <option key={objective.id} value={objective.id}>{objective.code} · {objective.title}</option>)}</select></label>
              </div>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Question<textarea value={checkPrompt} disabled={checkAttemptCount > 0} onChange={(event) => setCheckPrompt(event.target.value)} rows={3} placeholder="Which command prints the current working directory?" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100" /></label>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Choices and correct answer</p>
                <div className="mt-2 space-y-2">{checkOptions.map((option, index) => <div key={index} className="grid grid-cols-[44px_1fr_44px] gap-2"><label className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50" title="Correct answer"><input type="radio" name="correct-check-option" checked={checkCorrectOption === index} disabled={checkAttemptCount > 0} onChange={() => setCheckCorrectOption(index)} className="h-4 w-4 accent-primary-600" /></label><input aria-label={`Choice ${index + 1}`} value={option} disabled={checkAttemptCount > 0} onChange={(event) => setCheckOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Choice ${index + 1}`} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm disabled:bg-slate-100" /><button type="button" aria-label={`Remove choice ${index + 1}`} disabled={checkAttemptCount > 0 || checkOptions.length <= 2} onClick={() => { setCheckOptions((current) => current.filter((_, itemIndex) => itemIndex !== index)); setCheckCorrectOption((current) => current === index ? 0 : current > index ? current - 1 : current) }} className="flex h-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"><X className="h-4 w-4" /></button></div>)}</div>
                <button type="button" disabled={checkAttemptCount > 0 || checkOptions.length >= 6} onClick={() => setCheckOptions((current) => [...current, ''])} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 disabled:opacity-40"><Plus className="h-4 w-4" />Add choice</button>
              </div>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Explanation shown after every attempt<textarea value={checkExplanation} disabled={checkAttemptCount > 0} onChange={(event) => setCheckExplanation(event.target.value)} rows={3} placeholder="pwd means print working directory, so it shows the folder you are currently in." className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100" /></label>
            </div>}
          </section>

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
