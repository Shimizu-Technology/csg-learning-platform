import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { RichTextEditor } from '../../components/shared/RichTextEditor'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { VideoUploadField } from '../../components/admin/VideoUploadField'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'

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
    requires_submission: boolean
    s3_video_key?: string
    s3_video_content_type?: string
    s3_video_size?: number
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
  const [filename, setFilename] = useState('')
  const [requiresSubmission, setRequiresSubmission] = useState(false)
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
    await onCreate({
      title: title.trim(),
      release_day: releaseDay,
      video_url: videoUrl.trim() || undefined,
      instructions: instructions.trim() || undefined,
      solution: solution.trim() || undefined,
      filename: filename.trim() || undefined,
      requires_submission: requiresSubmission,
      ...(s3Video || {}),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl p-6 my-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Add Exercise</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Adding to: <span className="font-medium text-slate-700">{moduleName}</span></p>
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
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Row 2: Week, Day, Filename */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Week</label>
              <select
                value={week}
                onChange={e => setWeek(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
              <select
                value={dayIndex}
                onChange={e => setDayIndex(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors h-[38px] w-full">
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

          {/* Row 3: Video */}
          <VideoUploadField
            videoUrl={videoUrl}
            onVideoUrlChange={setVideoUrl}
            s3VideoKey={s3Video?.s3_video_key || null}
            onS3VideoUploaded={(data) => setS3Video(data)}
            onS3VideoRemoved={() => setS3Video(null)}
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
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create Exercise'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
