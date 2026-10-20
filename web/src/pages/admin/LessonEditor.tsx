import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Archive, ArrowLeft, Save, Eye, Pencil, Plus, RotateCcw, Target, X, ClipboardCheck, ListChecks } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { RichTextEditor } from '../../components/shared/RichTextEditor'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { VideoUploadField } from '../../components/admin/VideoUploadField'
import { AdminVideoPreview } from '../../components/admin/AdminVideoPreview'
import { VideoSegmentEditor } from '../../components/admin/VideoSegmentEditor'
import { CodeRunnerSettings } from '../../components/admin/CodeRunnerSettings'
import { useUpload } from '../../contexts/UploadContext'
import { useToast } from '../../contexts/ToastContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { resolveEditorVideoSource } from '../../lib/editorVideoSource'
import {
  buildSubmissionConfigWithRunner,
  codeRunnerLanguageFromEditor,
  normalizeCodeRunnerConfig,
  type CodeRunnerConfig,
} from '../../lib/codeRunner'
import { LearningObjectivesPanel } from '../../components/shared/LearningObjectivesPanel'
import type { LearningObjective, LessonObjective, Rubric } from '../../types/api'
import { normalizeVideoSegments, type VideoSegment } from '../../lib/videoSegments'
import { Button, IconButton } from '../../components/ui/Button'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'

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
  s3_video_content_type?: string | null
  s3_video_size?: number | null
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
  required: boolean
  requires_submission?: boolean
  submission_type?: string
  archived_at: string | null
  updated_at: string
  content_blocks: ContentBlock[]
  objectives: LessonObjective[]
}

type ObjectiveAlignmentDraft = { learning_objective_id: number; content_block_id: number | null }

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const { user } = useAuthContext()
  const canCreateCurriculumResources = Boolean(user?.is_admin)
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
  const [required, setRequired] = useState(true)
  const [runnerConfig, setRunnerConfig] = useState<CodeRunnerConfig>({
    enabled: false,
    language: 'ruby',
  })
  const [s3VideoKey, setS3VideoKey] = useState<string | null>(null)
  const [s3VideoContentType, setS3VideoContentType] = useState<string | null>(null)
  const [s3VideoSize, setS3VideoSize] = useState<number | null>(null)
  const [s3VideoUploadedAt, setS3VideoUploadedAt] = useState<string | null>(null)
  const [s3VideoUploadedBy, setS3VideoUploadedBy] = useState<string | null>(null)
  const [videoBlockId, setVideoBlockId] = useState<number | null>(null)
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([])
  const [pendingVideoUploadId, setPendingVideoUploadId] = useState<string | null>(null)
  const normalizedObjectiveAlignments = useMemo(() => objectiveAlignments.map((alignment) => (
    !checkEnabled && checkBlockId && alignment.content_block_id === checkBlockId
      ? { ...alignment, content_block_id: null }
      : alignment
  )), [checkBlockId, checkEnabled, objectiveAlignments])

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [archiveSaving, setArchiveSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  // Upload context — used to prefer in-flight upload's s3_key over a stale (null) fetch result.
  const { uploads, completeDeferredUpload } = useUpload()
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

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
        setRequired(l.required !== false)
        const videoBlock = l.content_blocks.find(b => b.block_type === 'video' || b.block_type === 'recording')
        if (videoBlock) {
          const videoSource = resolveEditorVideoSource(videoBlock.id, {
            s3Key: videoBlock.s3_video_key ?? null,
            contentType: videoBlock.s3_video_content_type ?? null,
            fileSize: videoBlock.s3_video_size ?? null,
          }, uploadsRef.current)
          setVideoUrl(videoBlock.video_url || '')
          setVideoBlockId(videoBlock.id)
          setVideoSegments(normalizeVideoSegments(videoBlock.metadata))
          setS3VideoKey(videoSource.s3Key)
          setS3VideoContentType(videoSource.contentType)
          setS3VideoSize(videoSource.fileSize)
          setS3VideoUploadedAt(videoBlock.s3_video_uploaded_at ?? null)
          setS3VideoUploadedBy(videoBlock.s3_video_uploaded_by ?? null)
        } else {
          setVideoUrl('')
          setVideoBlockId(null)
          setVideoSegments([])
          setS3VideoKey(null)
          setS3VideoContentType(null)
          setS3VideoSize(null)
          setS3VideoUploadedAt(null)
          setS3VideoUploadedBy(null)
          setPendingVideoUploadId(null)
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
  }, [id])

  // Stable callbacks so VideoUploadField's effect deps don't churn every render.
  const handleS3VideoUploaded = useCallback(
    (data: { s3_video_key: string; s3_video_content_type: string; s3_video_size: number }) => {
      setS3VideoKey(data.s3_video_key)
      setS3VideoContentType(data.s3_video_content_type)
      setS3VideoSize(data.s3_video_size)
      setS3VideoUploadedAt(null)
      setS3VideoUploadedBy(null)
    },
    []
  )
  const handleS3VideoRemoved = useCallback(() => {
    setS3VideoKey(null)
    setS3VideoContentType(null)
    setS3VideoSize(null)
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
        ...(!inFlightVideo ? { s3_video_key: s3VideoKey, s3_video_content_type: s3VideoContentType, s3_video_size: s3VideoSize } : {}),
        video_segments: videoSegments,
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
        base_updated_at: lesson.updated_at,
        title: title.trim(),
        required,
        requires_submission: submissionType !== 'manual_complete',
        video,
        exercise,
        ...(checkAttemptCount === 0 && (checkEnabled || checkBlockId) ? { retrieval_check: {
          enabled: checkEnabled,
          ...(checkBlockId ? { content_block_id: checkBlockId } : {}),
          title: checkTitle.trim() || 'Quick check',
          prompt: checkPrompt.trim(),
          options: cleanCheckOptions,
          correct_option: checkCorrectOption,
          explanation: checkExplanation.trim(),
          learning_objective_id: checkObjectiveId,
        } } : {}),
        alignments: normalizedObjectiveAlignments,
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
          const videoSource = resolveEditorVideoSource(refreshedVideo.id, {
            s3Key: refreshedVideo.s3_video_key ?? null,
            contentType: refreshedVideo.s3_video_content_type ?? null,
            fileSize: refreshedVideo.s3_video_size ?? null,
          }, uploadsRef.current)
          setVideoBlockId(refreshedVideo.id)
          setVideoSegments(normalizeVideoSegments(refreshedVideo.metadata))
          setS3VideoKey(videoSource.s3Key)
          setS3VideoContentType(videoSource.contentType)
          setS3VideoSize(videoSource.fileSize)
          setS3VideoUploadedAt(refreshedVideo.s3_video_uploaded_at ?? null)
          setS3VideoUploadedBy(refreshedVideo.s3_video_uploaded_by ?? null)
        } else {
          setVideoUrl('')
          setVideoBlockId(null)
          setVideoSegments([])
          setS3VideoKey(null)
          setS3VideoContentType(null)
          setS3VideoSize(null)
          setS3VideoUploadedAt(null)
          setS3VideoUploadedBy(null)
          setPendingVideoUploadId(null)
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

  const handleArchive = async () => {
    if (!lesson) return
    setArchiveSaving(true)
    const res = await api.archiveLesson(lesson.id, lesson.updated_at)
    if (res.error) {
      setSaveError(res.error)
      toast.error(res.error)
      setArchiveSaving(false)
    } else {
      setLesson(res.data!.lesson as Lesson)
      setConfirmArchive(false)
      setArchiveSaving(false)
      toast.success('Exercise archived. Its content and student history are preserved.')
    }
  }

  const handleRestore = async () => {
    if (!lesson) return
    setArchiveSaving(true)
    const res = await api.restoreLesson(lesson.id, lesson.updated_at)
    if (res.error) {
      setSaveError(res.error)
      toast.error(res.error)
    } else {
      setLesson(res.data!.lesson as Lesson)
      toast.success('Exercise restored to the student curriculum')
    }
    setArchiveSaving(false)
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

  const previewObjectives: LessonObjective[] = normalizedObjectiveAlignments.flatMap((alignment, index) => {
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
        metadata: { video_segments: videoSegments },
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
  }, [title, videoUrl, videoSegments, instructions, filename, s3VideoKey, videoBlockId, submissionType, runnerConfig, checkEnabled, checkPrompt, checkTitle, checkOptions, checkCorrectOption, checkExplanation, checkObjectiveId, objectiveCatalog])

  if (loading) return <LoadingSpinner message="Loading exercise..." />
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/admin/content" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>
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
        <Link to="/admin/content" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="app-eyebrow">Curriculum studio</p>
            <h1 className="app-title mt-2">Edit exercise</h1>
            <p className="text-sm text-ink-muted mt-1 tabular-nums">
              Week {week}, {DAY_NAMES[dayIdx] || `Day ${dayIdx + 1}`} · Day {lesson.release_day + 1} in the release calendar
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
            {/* Edit / Preview toggle */}
            <SegmentedControl label="Editor mode">
              <SegmentButton
                selected={mode === 'edit'}
                onClick={() => setMode('edit')}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </SegmentButton>
              <SegmentButton
                selected={mode === 'preview'}
                onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
              >
                <Eye className="h-3.5 w-3.5" />
                Student Preview
              </SegmentButton>
            </SegmentedControl>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {lesson.archived_at && (
        <div className="flex flex-col gap-4 rounded-2xl border border-warning-200 bg-warning-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" />
            <div>
              <p className="font-semibold text-warning-900">Archived exercise</p>
              <p className="mt-1 text-sm leading-6 text-warning-800">Students cannot see or continue into this exercise. Its content, progress, and submissions remain preserved.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={handleRestore} disabled={archiveSaving} className="shrink-0">
            <RotateCcw className="h-4 w-4" />
            {archiveSaving ? 'Restoring...' : 'Restore exercise'}
          </Button>
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{saveError}</div>
      )}
      {saveSuccess && (
        <div role="status" className="rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">Saved successfully!</div>
      )}

      {mode === 'preview' ? (
        /* ---- Student Preview ---- */
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-sm text-info-800">
            This is how students will see this exercise. Content shown is based on your current edits (save first to persist changes).
          </div>

          <div className="app-surface p-4 sm:p-6">
            <h1 className="text-xl font-bold text-ink">{title || 'Untitled Exercise'}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-ink-muted tabular-nums">
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
                lessonReturn={{ url: `${window.location.origin}/admin/lessons/${id}/edit?preview=true`, label: title }}
                starterOpensNewTab
              />
            ))}
          </div>

          {previewBlocks.length === 0 && (
            <div className="app-surface p-8 text-center text-ink-muted">
              No content to preview. Add a video URL or instructions to see the student view.
            </div>
          )}
        </div>
      ) : (
        /* ---- Edit Mode ---- */
        <>
          {/* Details card */}
          <div className="app-surface p-4 sm:p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-ink-secondary mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="app-control w-full"
              />
            </div>

            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-sunken px-4 py-3">
              <input
                type="checkbox"
                checked={required}
                onChange={e => setRequired(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line-strong text-primary-600"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  {required ? 'Required lesson' : 'Optional stretch'}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                  {required
                    ? 'Counts toward the student’s required weekly work.'
                    : 'Remains visible without counting toward required completion.'}
                </span>
              </span>
            </label>

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
                    <label className="block text-sm font-semibold text-ink-secondary mb-1.5">Filename</label>
                    <input
                      type="text"
                      value={filename}
                      onChange={e => setFilename(e.target.value)}
                      placeholder="e.g. 111.rb"
                      className="app-control w-full font-mono"
                    />
                    <p className="text-xs text-ink-muted mt-1">Leave blank if no submission</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-ink-secondary mb-1.5">Submission type</label>
                    <select
                      value={submissionType}
                      onChange={e => handleSubmissionTypeChange(e.target.value)}
                      className="app-control w-full"
                    >
                      <option value="manual_complete">Practice only</option>
                      <option value="text_submission">Text/code submission</option>
                      <option value="prework_github_sync">GitHub filename sync</option>
                      <option value="repo_url_submission">Repository submission</option>
                      <option value="repo_and_live_url_submission">Repo + live URL submission</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-xs text-ink-secondary">
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
            <VideoSegmentEditor value={videoSegments} onChange={setVideoSegments} />
          </div>


          <section className="app-surface p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Target className="h-5 w-5" /></span>
                <div>
                  <p className="text-xs font-semibold text-ink-muted">Learning design</p>
                  <h2 className="mt-1 text-lg font-bold text-ink">Objectives and success criteria</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">Tell students what they are building toward before they begin. Reuse objectives across lessons and attach each one to the whole lesson or a specific block.</p>
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
                  className="app-control"
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
                  <div key={objective.id} className="app-surface-muted p-4">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 rounded-lg border border-line bg-surface-raised px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">{objective.title}</p>
                        <p className="mt-1 text-sm leading-6 text-ink-secondary">{objective.success_criteria}</p>
                        <label className="mt-3 block text-xs font-semibold text-ink-secondary">
                          Applies to
                          <select
                            value={alignment.content_block_id || ''}
                            onChange={(event) => setObjectiveAlignments((current) => current.map((item) => item.learning_objective_id === objective.id ? { ...item, content_block_id: event.target.value ? Number(event.target.value) : null } : item))}
                            className="app-control mt-1 block w-full sm:max-w-md"
                          >
                            <option value="">Entire lesson</option>
                            {lesson.content_blocks.map((block) => <option key={block.id} value={block.id}>{block.title || `${block.block_type} block`}</option>)}
                          </select>
                        </label>
                      </div>
                      <IconButton label={`Remove ${objective.title}`} size="sm" onClick={() => setObjectiveAlignments((current) => current.filter((item) => item.learning_objective_id !== objective.id))}><X className="h-4 w-4" /></IconButton>
                    </div>
                  </div>
                )
              })}
              {!objectiveAlignments.length && <div className="rounded-2xl border border-dashed border-line-strong px-5 py-7 text-center text-sm text-ink-muted">{canCreateCurriculumResources ? 'No objectives yet. Create the first one below or reuse one from this curriculum.' : 'No objectives are attached yet. An admin can create reusable objectives for this curriculum.'}</div>}
            </div>

            {canCreateCurriculumResources && <div className="mt-5 app-surface-muted p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-ink-secondary">Objective code<input value={objectiveDraft.code} onChange={(event) => setObjectiveDraft((current) => ({ ...current, code: event.target.value }))} placeholder="TERM.1" className="app-control mt-1 block w-full font-mono" /></label>
                <label className="text-xs font-semibold text-ink-secondary">Student-facing title<input value={objectiveDraft.title} onChange={(event) => setObjectiveDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Navigate folders from the terminal" className="app-control mt-1 block w-full" /></label>
                <label className="text-xs font-semibold text-ink-secondary sm:col-span-2">Context (optional)<textarea value={objectiveDraft.description} onChange={(event) => setObjectiveDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What concept or skill this objective covers." rows={2} className="app-control mt-1 block w-full" /></label>
                <label className="text-xs font-semibold text-ink-secondary sm:col-span-2">Success criteria<textarea value={objectiveDraft.success_criteria} onChange={(event) => setObjectiveDraft((current) => ({ ...current, success_criteria: event.target.value }))} placeholder="I can move into a requested folder, go back one level, and confirm where I am." rows={3} className="app-control mt-1 block w-full" /></label>
              </div>
              <Button variant="secondary" disabled={creatingObjective} onClick={() => void handleCreateObjective()} className="mt-3"><Plus className="h-4 w-4" />{creatingObjective ? 'Creating…' : 'Create and add objective'}</Button>
            </div>}
          </section>

          <section className="app-surface p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ClipboardCheck className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-semibold text-ink-muted">Evidence and feedback</p>
                <h2 className="mt-1 text-lg font-bold text-ink">Student-visible rubric</h2>
                <p className="mt-1 text-sm leading-6 text-ink-muted">Show the criteria before submission, then return a rating and focused feedback for every criterion.</p>
              </div>
            </div>
            <label className="mt-5 block text-xs font-semibold text-ink-secondary">Attached rubric
              <select value={selectedRubricId || ''} onChange={(event) => setSelectedRubricId(event.target.value ? Number(event.target.value) : null)} className="app-control mt-1 block w-full">
                <option value="">No rubric</option>
                {rubricCatalog.filter((rubric) => rubric.active !== false).map((rubric) => <option key={rubric.id} value={rubric.id}>{rubric.title} · {rubric.criteria.length} criteria</option>)}
              </select>
            </label>
            {selectedRubricId && rubricCatalog.find((rubric) => rubric.id === selectedRubricId) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {rubricCatalog.find((rubric) => rubric.id === selectedRubricId)!.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-line bg-surface-sunken p-3"><p className="text-sm font-semibold text-ink">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{criterion.description}</p></div>)}
              </div>
            )}
            {canCreateCurriculumResources && <div className="mt-5 app-surface-muted p-4">
              <p className="text-base font-semibold text-ink">Create a reusable rubric</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-ink-secondary">Rubric title<input value={rubricDraft.title} onChange={(event) => setRubricDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Project quality" className="app-control mt-1 block w-full" /></label>
                <label className="text-xs font-semibold text-ink-secondary">Purpose (optional)<input value={rubricDraft.description} onChange={(event) => setRubricDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this rubric evaluates" className="app-control mt-1 block w-full" /></label>
              </div>
              <div className="mt-3 space-y-3">
                {rubricDraft.criteria.map((criterion, index) => <div key={index} className="grid gap-2 rounded-xl border border-line bg-surface-raised p-3 sm:grid-cols-[0.7fr_1.3fr_auto]"><input aria-label={`Criterion ${index + 1} title`} value={criterion.title} onChange={(event) => setRubricDraft((current) => ({ ...current, criteria: current.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} placeholder="Criterion title" className="app-control" /><input aria-label={`Criterion ${index + 1} description`} value={criterion.description} onChange={(event) => setRubricDraft((current) => ({ ...current, criteria: current.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} placeholder="What meeting this criterion looks like" className="app-control" /><IconButton label={`Remove criterion ${index + 1}`} size="sm" disabled={rubricDraft.criteria.length === 1} onClick={() => setRubricDraft((current) => ({ ...current, criteria: current.criteria.filter((_, itemIndex) => itemIndex !== index) }))}><X className="h-4 w-4" /></IconButton></div>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="quiet" onClick={() => setRubricDraft((current) => ({ ...current, criteria: [...current.criteria, { title: '', description: '' }] }))}><Plus className="h-4 w-4" />Add criterion</Button><Button variant="secondary" disabled={creatingRubric} onClick={() => void handleCreateRubric()}><ClipboardCheck className="h-4 w-4" />{creatingRubric ? 'Creating…' : 'Create and select rubric'}</Button></div>
            </div>}
          </section>

          <section className="app-surface p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ListChecks className="h-5 w-5" /></span>
                <div>
                  <p className="text-xs font-semibold text-ink-muted">Retrieval practice</p>
                  <h2 className="mt-1 text-lg font-bold text-ink">Quick recall check</h2>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">Use one low-stakes question to help students retrieve a foundational idea. They receive an explanation immediately and can retry.</p>
                </div>
              </div>
              <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-sunken px-4 text-sm font-semibold text-ink-secondary"><input type="checkbox" checked={checkEnabled} disabled={checkAttemptCount > 0} onChange={(event) => setCheckEnabled(event.target.checked)} className="h-4 w-4 accent-primary-600" />Include check</label>
            </div>
            {checkAttemptCount > 0 && <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-800"><span className="tabular-nums">{checkAttemptCount}</span> student {checkAttemptCount === 1 ? 'attempt is' : 'attempts are'} recorded. The question is locked to preserve that evidence; create a new check if the standard changes.</div>}
            {checkEnabled && <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-ink-secondary">Check title<input value={checkTitle} disabled={checkAttemptCount > 0} onChange={(event) => setCheckTitle(event.target.value)} placeholder="Quick check" className="app-control mt-1 block w-full" /></label>
                <label className="text-xs font-semibold text-ink-secondary">Aligned objective<select value={checkObjectiveId || ''} disabled={checkAttemptCount > 0} onChange={(event) => setCheckObjectiveId(event.target.value ? Number(event.target.value) : null)} className="app-control mt-1 block w-full"><option value="">No specific objective</option>{objectiveCatalog.filter((objective) => objective.active).map((objective) => <option key={objective.id} value={objective.id}>{objective.code} · {objective.title}</option>)}</select></label>
              </div>
              <label className="block text-xs font-semibold text-ink-secondary">Question<textarea value={checkPrompt} disabled={checkAttemptCount > 0} onChange={(event) => setCheckPrompt(event.target.value)} rows={3} placeholder="Which command prints the current working directory?" className="app-control mt-1 block w-full" /></label>
              <div>
                <p className="text-xs font-semibold text-ink-secondary">Choices and correct answer</p>
                <div className="mt-2 space-y-2">{checkOptions.map((option, index) => <div key={index} className="grid grid-cols-[44px_1fr_44px] gap-2"><label className="flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-sunken" title="Correct answer"><input type="radio" name="correct-check-option" checked={checkCorrectOption === index} disabled={checkAttemptCount > 0} onChange={() => setCheckCorrectOption(index)} className="h-4 w-4 accent-primary-600" /></label><input aria-label={`Choice ${index + 1}`} value={option} disabled={checkAttemptCount > 0} onChange={(event) => setCheckOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Choice ${index + 1}`} className="app-control" /><IconButton label={`Remove choice ${index + 1}`} disabled={checkAttemptCount > 0 || checkOptions.length <= 2} onClick={() => { setCheckOptions((current) => current.filter((_, itemIndex) => itemIndex !== index)); setCheckCorrectOption((current) => current === index ? 0 : current > index ? current - 1 : current) }}><X className="h-4 w-4" /></IconButton></div>)}</div>
                <Button variant="quiet" disabled={checkAttemptCount > 0 || checkOptions.length >= 6} onClick={() => setCheckOptions((current) => [...current, ''])} className="mt-2"><Plus className="h-4 w-4" />Add choice</Button>
              </div>
              <label className="block text-xs font-semibold text-ink-secondary">Explanation shown after every attempt<textarea value={checkExplanation} disabled={checkAttemptCount > 0} onChange={(event) => setCheckExplanation(event.target.value)} rows={3} placeholder="pwd means print working directory, so it shows the folder you are currently in." className="app-control mt-1 block w-full" /></label>
            </div>}
          </section>

          {/* Instructions — WYSIWYG editor */}
          <div className="app-surface p-4 sm:p-6">
            <RichTextEditor
              value={instructions}
              onChange={setInstructions}
              label="Instructions"
              placeholder="Write exercise instructions here..."
              height={400}
            />
          </div>

          {/* Solution — Code editor */}
          <div className="app-surface p-4 sm:p-6">
            <div className="flex items-end justify-between mb-1.5">
              <div>
                <span className="text-sm font-semibold text-ink-secondary">Solution</span>
                <span className="text-sm font-normal text-ink-muted ml-1">(staff only)</span>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {!lesson.archived_at && (confirmArchive ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 p-2">
                  <span className="px-1 text-sm font-semibold text-danger-700">Archive this exercise?</span>
                  <Button
                    variant="danger"
                    onClick={handleArchive}
                    disabled={archiveSaving}
                  >
                    {archiveSaving ? 'Archiving...' : 'Archive safely'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmArchive(false)}
                    disabled={archiveSaving}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="danger"
                  onClick={() => setConfirmArchive(true)}
                >
                  <Archive className="h-4 w-4" />
                  Archive exercise
                </Button>
              ))}
            </div>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
