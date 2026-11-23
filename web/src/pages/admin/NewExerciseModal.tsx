import { useAuthContext } from '../../contexts/AuthContext'
import { useId, useMemo, useState } from 'react'
import { LazyMarkdownEditor } from '../../components/shared/LazyMarkdownEditor'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'
import { Modal } from '../../components/shared/Modal'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { VideoUploadField } from '../../components/admin/VideoUploadField'
import { CodeRunnerSettings } from '../../components/admin/CodeRunnerSettings'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'
import {
  buildSubmissionConfigWithRunner,
  codeRunnerLanguageFromEditor,
  type CodeRunnerConfig,
} from '../../lib/codeRunner'
import { Button } from '../../components/ui/Button'
import { SUBMISSION_TYPE_OPTIONS, submissionTypeHint } from './lessonEditor/submissionTypes'

const renderLessonPreview = (markdown: string) => <MarkdownRenderer content={markdown} />

interface Props {
  moduleName: string
  scheduleDays: string
  weekCount: number
  defaultWeek: number
  defaultDayIndex: number
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: {
    title: string
    release_day: number
    required: boolean
    video_url?: string
    instructions?: string
    solution?: string
    filename?: string
    requires_submission?: boolean
    submission_type?: string
    submission_config?: Record<string, unknown>
    s3_video_key?: string
    s3_video_content_type?: string
    s3_video_size?: number
    upload_id?: string
  }) => Promise<void>
}

export function NewExerciseModal({
  moduleName,
  scheduleDays,
  weekCount,
  defaultWeek,
  defaultDayIndex,
  saving,
  error,
  onClose,
  onCreate,
}: Props) {
  const { user } = useAuthContext()
  const [title, setTitle] = useState('')
  const [week, setWeek] = useState(defaultWeek)
  const [dayIndex, setDayIndex] = useState(defaultDayIndex)
  const [videoUrl, setVideoUrl] = useState('')
  const [instructions, setInstructions] = useState('')
  const [solution, setSolution] = useState('')
  const [s3Video, setS3Video] = useState<{ s3_video_key: string; s3_video_content_type: string; s3_video_size: number } | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [submissionType, setSubmissionType] = useState('manual_complete')
  const [required, setRequired] = useState(true)
  const [runnerConfig, setRunnerConfig] = useState<CodeRunnerConfig>({
    enabled: false,
    language: 'ruby',
  })
  const [validationError, setValidationError] = useState('')
  const formId = useId()

  const availableDays = useMemo(() => {
    const indices = SCHEDULE_DAY_INDICES[scheduleDays] || SCHEDULE_DAY_INDICES.weekdays
    return indices.map(i => ({ index: i, name: ALL_DAY_NAMES[i] }))
  }, [scheduleDays])

  const releaseDay = (week - 1) * 7 + dayIndex

  const weekOptions = useMemo(() => {
    const max = Math.max(weekCount + 2, week + 1, 12)
    return Array.from({ length: max }, (_, i) => i + 1)
  }, [weekCount, week])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setValidationError('Title is required')
      return
    }
    if (!videoUrl.trim() && !instructions.trim() && !s3Video) {
      setValidationError('Add instructions, a video, or both. An exercise can\'t be empty.')
      return
    }
    setValidationError('')
    const detectedLanguage = detectLanguage(filename)
    const runnerLanguage = runnerConfig.enabled
      ? runnerConfig.language
      : codeRunnerLanguageFromEditor(detectedLanguage) || runnerConfig.language
    const submissionRunnerConfig = submissionType === 'text_submission'
      ? { ...runnerConfig, language: runnerLanguage }
      : { ...runnerConfig, enabled: false, language: runnerLanguage }
    await onCreate({
      title: title.trim(),
      release_day: releaseDay,
      required,
      video_url: videoUrl.trim() || undefined,
      instructions: instructions.trim() || undefined,
      solution: solution.trim() || undefined,
      filename: filename.trim() || undefined,
      requires_submission: submissionType !== 'manual_complete',
      submission_type: submissionType,
      submission_config: buildSubmissionConfigWithRunner(undefined, submissionRunnerConfig),
      ...(s3Video || {}),
      upload_id: uploadId || undefined,
    })
  }

  const handleSubmissionTypeChange = (nextType: string) => {
    setSubmissionType(nextType)
    if (nextType !== 'text_submission') {
      setRunnerConfig((current) => ({ ...current, enabled: false }))
    }
  }

  if (!user?.is_admin) return <Modal open title="Shared course library" onClose={onClose}><p>Only admins can change the shared course library.</p></Modal>

  return (
    <Modal
      open
      title="Add exercise"
      subtitle={`Adding to ${moduleName}`}
      size="xl"
      fixedHeight
      onClose={onClose}
      footer={(
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={onClose}
            disabled={saving}
            variant="secondary"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={saving} className="flex-1">
            {saving ? 'Creating...' : 'Create exercise'}
          </Button>
        </div>
      )}
    >
      {(validationError || error) && <p role="alert" className="mb-3 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-ink">{validationError || error}</p>}

      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
          <p className="rounded-xl border border-info-line bg-info-soft px-3 py-2 text-sm text-info-ink">An exercise needs instructions, a video, or both. You can add more blocks after it's created.</p>

          <div>
            <label htmlFor={`${formId}-title`} className="mb-1 block text-sm font-medium text-ink-secondary">Title</label>
            <input
              id={`${formId}-title`}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Custom methods"
              className="app-control w-full"
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-ink-secondary">Instructions</span>
            <LazyMarkdownEditor
              label="Exercise instructions"
              value={instructions}
              onChange={setInstructions}
              placeholder="What should students build or answer?"
              variant="field"
              target="lesson"
              renderPreview={renderLessonPreview}
              minHeight={160}
              maxHeight={420}
            />
          </div>

          <VideoUploadField
            videoUrl={videoUrl}
            onVideoUrlChange={setVideoUrl}
            s3VideoKey={s3Video?.s3_video_key || null}
            onS3VideoUploaded={(data) => setS3Video(data)}
            onS3VideoRemoved={() => { setS3Video(null); setUploadId(null) }}
            onUploadStarted={(id) => setUploadId(id)}
            contextLabel={title.trim() ? `Exercise: ${title.trim()}` : 'New exercise'}
            compact
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${formId}-week`} className="mb-1 block text-sm font-medium text-ink-secondary">Week</label>
              <select id={`${formId}-week`} value={week} onChange={e => setWeek(Number(e.target.value))} className="app-control w-full">
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${formId}-day`} className="mb-1 block text-sm font-medium text-ink-secondary">Day</label>
              <select id={`${formId}-day`} value={dayIndex} onChange={e => setDayIndex(Number(e.target.value))} className="app-control w-full">
                {availableDays.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${formId}-submission-type`} className="mb-1 block text-sm font-medium text-ink-secondary">Submission type</label>
              <select
                id={`${formId}-submission-type`}
                value={submissionType}
                onChange={e => handleSubmissionTypeChange(e.target.value)}
                className="app-control w-full min-w-0 truncate"
              >
                {SUBMISSION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${formId}-filename`} className="mb-1 block text-sm font-medium text-ink-secondary">Filename</label>
              <input
                id={`${formId}-filename`}
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                placeholder="111.rb"
                className="app-control w-full font-mono"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-ink-muted">{submissionTypeHint(submissionType)}</p>
          {submissionType === 'text_submission' && (
            <CodeRunnerSettings value={runnerConfig} onChange={setRunnerConfig} compact />
          )}

          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <input
              type="checkbox"
              checked={required}
              onChange={e => setRequired(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line-strong text-primary-ink"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">
                {required ? 'Required lesson' : 'Optional stretch'}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                {required
                  ? 'Counts toward the student’s required weekly work.'
                  : 'Remains available to the student without counting toward required completion.'}
              </span>
            </span>
          </label>

          <div>
            <div className="mb-1.5">
              <span className="text-sm font-semibold text-ink-secondary">Solution</span>
              <span className="ml-1 text-sm font-normal text-ink-muted">(optional, staff only)</span>
            </div>
            <CodeEditor
              ariaLabel="Solution code"
              value={solution}
              onChange={setSolution}
              language={detectLanguage(filename)}
              minHeight={200}
            />
          </div>

      </form>
    </Modal>
  )
}
