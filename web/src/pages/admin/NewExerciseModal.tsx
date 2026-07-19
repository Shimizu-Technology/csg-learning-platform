import { useState, useMemo } from 'react'
import { RichTextEditor } from '../../components/shared/RichTextEditor'
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
  const [runnerConfig, setRunnerConfig] = useState<CodeRunnerConfig>({
    enabled: false,
    language: 'ruby',
  })
  const [validationError, setValidationError] = useState('')

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
      setValidationError('Please provide a video, exercise instructions, or both')
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

  return (
    <Modal open title="Add exercise" subtitle={`Adding to ${moduleName}`} size="xl" fixedHeight onClose={onClose}>
        {(validationError || error) && <p className="text-sm text-red-600 mb-3">{validationError || error}</p>}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Row 1: Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Custom Methods"
              className="app-control"
              autoFocus
            />
          </div>

          {/* Row 2: Week, Day, Filename, Submission */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Week</label>
              <select
                value={week}
                onChange={e => setWeek(Number(e.target.value))}
                className="app-control"
              >
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
              <select
                value={dayIndex}
                onChange={e => setDayIndex(Number(e.target.value))}
                className="app-control"
              >
                {availableDays.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Filename</label>
              <input
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                placeholder="e.g. 111.rb"
                className="app-control font-mono text-xs"
              />
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">Submission Type</label>
              <select
                value={submissionType}
                onChange={e => handleSubmissionTypeChange(e.target.value)}
                className="app-control"
              >
                <option value="manual_complete">Practice only</option>
                <option value="text_submission">Text/code submission</option>
                <option value="prework_github_sync">GitHub filename sync</option>
                <option value="repo_url_submission">Repository submission</option>
                <option value="repo_and_live_url_submission">Repo + live URL submission</option>
              </select>
              {submissionType === 'text_submission' && (
                <CodeRunnerSettings
                  value={runnerConfig}
                  onChange={setRunnerConfig}
                  compact
                />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {submissionType === 'manual_complete' && 'Students mark this as complete themselves. No instructor review queue item is created.'}
            {submissionType === 'text_submission' && 'Students paste code/text directly into the app for grading.'}
            {submissionType === 'prework_github_sync' && 'Use this only for prework-style filename sync from GitHub.'}
            {submissionType === 'repo_url_submission' && 'Students submit a repository URL and optional notes. Extra Git details stay available only when needed.'}
            {submissionType === 'repo_and_live_url_submission' && 'Students submit a repository URL and a deployed live URL. Notes stay optional.'}
          </div>

          {/* Row 3: Video */}
          <VideoUploadField
            videoUrl={videoUrl}
            onVideoUrlChange={setVideoUrl}
            s3VideoKey={s3Video?.s3_video_key || null}
            onS3VideoUploaded={(data) => setS3Video(data)}
            onS3VideoRemoved={() => { setS3Video(null); setUploadId(null) }}
            onUploadStarted={(id) => setUploadId(id)}
            contextLabel={title.trim() ? `Exercise: ${title.trim()}` : 'New Exercise'}
            compact
          />

          {/* Instructions — WYSIWYG */}
          <RichTextEditor
            value={instructions}
            onChange={setInstructions}
            label="Instructions"
            placeholder="Write exercise instructions here..."
            height={280}
          />

          {/* Solution — Code editor */}
          <div>
            <div className="mb-1.5">
              <span className="text-sm font-semibold text-slate-700">Solution</span>
              <span className="text-sm font-normal text-slate-400 ml-1">(optional)</span>
            </div>
            <CodeEditor
              value={solution}
              onChange={setSolution}
              language={detectLanguage(filename)}
              minHeight={200}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={onClose}
              disabled={saving}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? 'Creating...' : 'Create exercise'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}
