import { useCallback, useId, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Code2, Copy, GripVertical, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Modal } from '../../../components/shared/Modal'
import { LazyMarkdownEditor } from '../../../components/shared/LazyMarkdownEditor'
import { MarkdownRenderer } from '../../../components/shared/MarkdownRenderer'
import { CodeEditor, detectLanguage } from '../../../components/shared/CodeEditor'
import { videoVersions, type VideoVersion } from '../../../lib/videoVersions'
import { VideoVersionsEditor } from '../../../components/admin/VideoVersionsEditor'
import { VideoUploadField } from '../../../components/admin/VideoUploadField'
import { AdminVideoPreview } from '../../../components/admin/AdminVideoPreview'
import { VideoSegmentEditor } from '../../../components/admin/VideoSegmentEditor'
import { buildSubmissionConfigWithRunner, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../../lib/codeRunner'
import { sectionDuration, videoSectionErrors } from '../../../lib/videoSectionDraft'
import { Badge } from '../../../components/ui/Badge'
import { Button, IconButton } from '../../../components/ui/Button'
import type { BlockLearnerActivity } from '../../../types/api'
import { BLOCK_ICONS } from './AddBlockMenu'
import { BLOCK_LABELS, emptyCheck, type BlockDraft, type CheckDraft } from './blockDraft'
import { REVIEWED_SUBMISSION_TYPES, submissionTypeHint } from './submissionTypes'
import { LiveUrlToggle, SubmissionTypeSelect } from './SubmissionTypeField'

export function hasLearnerWork(activity?: BlockLearnerActivity) {
  return Boolean(activity && (activity.submissions || activity.progress || activity.watched || activity.check_attempts))
}

/** "5 submissions · 12 with progress" for a block's learner work. */
export function learnerWorkSummary(activity?: BlockLearnerActivity) {
  if (!activity) return ''
  const parts: string[] = []
  if (activity.submissions) parts.push(`${activity.submissions} ${activity.submissions === 1 ? 'submission' : 'submissions'}`)
  if (activity.check_attempts) parts.push(`${activity.check_attempts} check ${activity.check_attempts === 1 ? 'attempt' : 'attempts'}`)
  if (activity.progress && !activity.submissions) parts.push(`${activity.progress} with progress`)
  return parts.join(' · ')
}

const renderLessonPreview = (markdown: string) => <MarkdownRenderer content={markdown} />

interface BlockCardProps {
  block: BlockDraft
  index: number
  total: number
  lessonId: number
  activity?: BlockLearnerActivity
  selected: boolean
  problem?: string | null
  readOnly?: boolean
  dropIndicator?: 'before' | 'after' | null
  onSelect: () => void
  onOpenSettings?: () => void
  onSaveBlock?: () => void
  onChange: (patch: Partial<BlockDraft>) => void
  onAddVideoVersion?: (version: VideoVersion) => boolean
  onMove: (to: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  canDuplicate: boolean
}

export function BlockCard({
  block, index, total, lessonId, activity, selected, problem, readOnly = false, dropIndicator,
  onSelect, onOpenSettings, onSaveBlock, onChange, onAddVideoVersion, onMove, onDuplicate, onDelete, onDragStart, onDragOver, onDrop, onDragEnd, canDuplicate,
}: BlockCardProps) {
  const id = useId()
  const [solutionOpen, setSolutionOpen] = useState(false)
  const Icon = BLOCK_ICONS[block.block_type]
  const label = BLOCK_LABELS[block.block_type]
  const work = hasLearnerWork(activity)
  const workSummary = learnerWorkSummary(activity)
  const isVideo = block.block_type === 'video' || block.block_type === 'recording'
  const duration = sectionDuration(block)
  const sectionsNeedReview = block.video_segments.some((section) => Object.values(videoSectionErrors(section, duration)).some(Boolean))
  const isExercise = block.block_type === 'exercise' || block.block_type === 'code_challenge'
  const position = `${label} block, ${index + 1} of ${total}`

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      onMove(index - 1)
    } else if (event.key === 'ArrowDown' && index < total - 1) {
      event.preventDefault()
      onMove(index + 1)
    } else if (event.key === 'Home' && index > 0) {
      event.preventDefault()
      onMove(0)
    } else if (event.key === 'End' && index < total - 1) {
      event.preventDefault()
      onMove(total - 1)
    }
  }

  const handleUploaded = useCallback((data: { s3_video_key: string; s3_video_content_type: string; s3_video_size: number }) => {
    onChange({ s3_video_key: data.s3_video_key, s3_video_content_type: data.s3_video_content_type, s3_video_size: data.s3_video_size, s3_video_duration_seconds: null, metadata: { ...block.metadata, video_versions_duration_seconds: undefined } })
  }, [onChange, block.metadata])
  const handleRemoved = useCallback(() => onChange({ s3_video_key: null, s3_video_content_type: null, s3_video_size: null, s3_video_duration_seconds: null, metadata: { ...block.metadata, video_versions_duration_seconds: undefined } }), [onChange, block.metadata])
  const handleUrl = useCallback((url: string) => onChange({ video_url: url }), [onChange])

  const reviewed = REVIEWED_SUBMISSION_TYPES.has(block.submission_type || '')
  const badge = isExercise || block.block_type === 'checkpoint'
    ? (reviewed ? 'Submission' : block.block_type === 'checkpoint' && block.check ? 'Retrieval check' : isExercise ? 'Practice' : null)
    : null

  return (
    <article
      data-block-key={block.key}
      aria-label={position}
      aria-current={selected ? 'true' : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
      className={`relative rounded-2xl border bg-surface-raised transition-[border-color,box-shadow] duration-150 ${selected ? 'border-primary-soft-line ring-3 ring-primary-soft' : problem ? 'border-warning-line' : 'border-line'}`}
    >
      {dropIndicator && <span aria-hidden="true" className={`absolute inset-x-3 h-0.5 rounded-full bg-focus ${dropIndicator === 'before' ? '-top-1.5' : '-bottom-1.5'}`} />}
      <header className="flex min-h-12 items-center gap-1.5 border-b border-line py-1.5 pl-1.5 pr-2 text-sm font-bold text-ink-secondary">
        {!readOnly && (
          <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onKeyDown={onHandleKey}
            aria-label={`Move ${position}`}
            aria-describedby={`${id}-move-hint`}
            className="grid h-11 w-8 shrink-0 cursor-grab place-items-center rounded-lg text-ink-disabled hover:bg-surface-sunken hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:cursor-grabbing lg:h-9"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <span id={`${id}-move-hint`} hidden>Drag, or use the up and down arrow keys, to move this block.</span>
        <Icon className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{label}</span>
        {block.title.trim() && <span className="min-w-0 truncate font-semibold text-ink-muted">· {block.title.trim()}</span>}
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 sm:flex">
          {block.id === null && <Badge tone="warning">New</Badge>}
          {badge && <Badge tone={reviewed ? 'brand' : 'neutral'}>{badge}</Badge>}
          {workSummary && <Badge tone="info">{workSummary}</Badge>}
        </span>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={`Move ${label.toLowerCase()} block up`}
              size="sm"
              variant="quiet"
              onClick={() => onMove(index - 1)}
              disabled={index === 0}
              title={index === 0 ? 'Already first block' : 'Move up'}
            >
              <ArrowUp className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={`Move ${label.toLowerCase()} block down`}
              size="sm"
              variant="quiet"
              onClick={() => onMove(index + 1)}
              disabled={index === total - 1}
              title={index === total - 1 ? 'Already last block' : 'Move down'}
            >
              <ArrowDown className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={`Duplicate ${label.toLowerCase()} block`}
              size="sm"
              variant="quiet"
              onClick={onDuplicate}
              disabled={!canDuplicate}
              title={canDuplicate ? 'Duplicate block' : 'A lesson can have at most 20 blocks'}
            >
              <Copy className="h-4 w-4" />
            </IconButton>
            {onOpenSettings && (
              <IconButton
                label={`Edit settings for ${label.toLowerCase()} block`}
                size="sm"
                variant="quiet"
                onClick={onOpenSettings}
                title="Edit block settings"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton
              label={work ? `${label} block has learner work and can't be deleted` : `Delete ${label.toLowerCase()} block`}
              size="sm"
              variant="quiet"
              onClick={onDelete}
              disabled={work || total <= 1}
              title={work ? `Students have work here (${workSummary}). Keep the block so it isn't lost.` : total <= 1 ? 'A lesson needs at least one block' : 'Delete block'}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 px-3 py-4 sm:px-4">
        {problem && <p role="status" className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink">{problem}</p>}

        {block.block_type !== 'text' && (
          <div>
            <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold text-ink-secondary">Title</label>
            <input
              id={`${id}-title`}
              value={block.title}
              readOnly={readOnly}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder={isExercise ? 'Ticket prices' : block.block_type === 'checkpoint' ? 'Quick check' : 'Walkthrough'}
              className="app-control w-full"
            />
          </div>
        )}

        {(block.block_type === 'text' || isExercise || block.block_type === 'checkpoint') && (
          <div>
            {block.block_type !== 'text' && <span id={`${id}-body-label`} className="mb-1.5 block text-sm font-semibold text-ink-secondary">{isExercise ? 'Instructions' : 'Instructions (optional)'}</span>}
            <LazyMarkdownEditor
              label={block.block_type === 'text' ? `Text block ${index + 1}` : `${label} instructions`}
              value={block.body}
              onChange={(markdown) => onChange({ body: markdown })}
              placeholder={block.block_type === 'text' ? 'Write the lesson text' : isExercise ? 'What should students build or answer?' : 'What should students do at this checkpoint?'}
              variant="field"
              target="lesson"
              renderPreview={renderLessonPreview}
              disabled={readOnly}
              minHeight={block.block_type === 'text' ? 140 : 110}
              maxHeight={520}
            />
            {block.block_type === 'text' && <p className="mt-1.5 text-xs text-ink-muted">Rich and Markdown save the same text. Code blocks get highlighting and a Copy button where students read them.</p>}
          </div>
        )}

        {isVideo && (
          <div className="grid grid-cols-1 gap-3">
            {videoVersions(block.metadata).length > 0 ? <p className="text-sm text-ink-secondary">Manage the versions below. Remove all versions before replacing the original upload.</p> : block.id !== null && !readOnly ? (
              <VideoUploadField
                contentBlockId={block.id}
                lessonId={lessonId}
                contextLabel={block.title ? `Video: ${block.title}` : 'Lesson video'}
                videoUrl={block.video_url}
                onVideoUrlChange={handleUrl}
                s3VideoKey={block.s3_video_key}
                onS3VideoUploaded={handleUploaded}
                onS3VideoRemoved={handleRemoved}
                deferPersistence
                compact
              />
            ) : (
              <div>
                <label htmlFor={`${id}-url`} className="mb-1.5 block text-sm font-semibold text-ink-secondary">Video link</label>
                <input
                  id={`${id}-url`}
                  type="url"
                  inputMode="url"
                  value={block.video_url}
                  readOnly={readOnly}
                  onChange={(event) => onChange({ video_url: event.target.value })}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="app-control w-full"
                />
                {!readOnly && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2">
                    <p className="text-xs text-ink-secondary">Want to upload a video file instead of pasting a link? Save this block first.</p>
                    {onSaveBlock && (
                      <Button variant="secondary" size="sm" onClick={onSaveBlock}>
                        Save block to upload video
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
            {block.s3_video_key && !readOnly && <VideoVersionsEditor metadata={block.metadata} onAppendVersion={(version) => onAddVideoVersion?.(version) ?? false} anchorDuration={block.s3_video_duration_seconds} onChange={(metadata) => onChange({ metadata })} />}
            {(block.video_url.trim() || block.s3_video_key) && (
              <AdminVideoPreview contentBlockId={block.id} s3VideoKey={block.s3_video_key} videoUrl={block.video_url} title={block.title} />
            )}
            {!readOnly && (
              <details className="rounded-xl border border-line px-3 py-2">
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 text-sm font-semibold text-ink-secondary">
                  <span>Sections{block.video_segments.length ? ` (${block.video_segments.length})` : ''}</span>
                  {sectionsNeedReview && <span className="text-xs text-danger-ink">Review section fields</span>}
                </summary>
                <div className="pb-2 pt-1"><VideoSegmentEditor value={block.video_segments} duration={duration}
                  hasVersions={Array.isArray(block.metadata.video_versions) && block.metadata.video_versions.length > 0}
                  onChange={(segments) => onChange({ video_segments: segments })} /></div>
              </details>
            )}
          </div>
        )}

        {(isExercise || block.block_type === 'checkpoint') && !readOnly && (() => {
          const runner = normalizeCodeRunnerConfig(block.submission_config, codeRunnerLanguageFromEditor(detectLanguage(block.filename)) || 'ruby')
          return (
            <div className="rounded-xl border border-line bg-surface-sunken/50 px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label htmlFor={`${id}-students-submit`} className="text-sm font-semibold text-ink-secondary">
                  Students submit
                </label>
                <SubmissionTypeSelect
                  id={`${id}-students-submit`}
                  value={block.submission_type}
                  onChange={(value) => {
                    onChange({
                      submission_type: value,
                      submission_config: buildSubmissionConfigWithRunner(
                        block.submission_config,
                        value === 'text_submission' ? runner : { ...runner, enabled: false },
                      ),
                    })
                  }}
                  className="app-control w-full sm:w-64"
                />
              </div>
              <LiveUrlToggle value={block.submission_type} onChange={(value) => onChange({ submission_type: value })} />
              <p className="mt-1 text-xs text-ink-muted">{submissionTypeHint(block.submission_type)}</p>
            </div>
          )
        })()}

        {isExercise && !readOnly && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2">
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink-secondary">
              Solution (staff only)
              <span className="ml-1 font-normal text-ink-muted">{block.solution.trim() ? `· ${block.solution.trim().split('\n').length} ${block.solution.trim().split('\n').length === 1 ? 'line' : 'lines'}` : '· empty'}</span>
            </span>
            <Button variant="quiet" size="sm" onClick={() => setSolutionOpen(true)}><Code2 className="h-4 w-4" />{block.solution.trim() ? 'Edit solution' : 'Add solution'}</Button>
          </div>
        )}
        {/* The code editor lives in a dialog: Monaco can't survive its card being moved in the DOM. */}
        <Modal open={solutionOpen} onClose={() => setSolutionOpen(false)} size="xl" title={`Solution for ${block.title.trim() || label.toLowerCase()}`} subtitle="Staff only. Students never see it." footer={<Button onClick={() => setSolutionOpen(false)}>Done</Button>}>
          {solutionOpen && <CodeEditor ariaLabel="Solution code" value={block.solution} onChange={(solution) => onChange({ solution })} language={detectLanguage(block.filename)} minHeight={320} />}
        </Modal>

        {block.block_type === 'checkpoint' && (
          <CheckEditor
            idBase={id}
            check={block.check}
            locked={block.check_locked || readOnly}
            attempts={activity?.check_attempts || 0}
            onChange={(check) => onChange({ check })}
          />
        )}
      </div>
    </article>
  )
}

function CheckEditor({ idBase, check, locked, attempts, onChange }: {
  idBase: string
  check: CheckDraft | null
  locked: boolean
  attempts: number
  onChange: (check: CheckDraft | null) => void
}) {
  if (!check) {
    return locked ? null : (
      <div className="rounded-xl border border-dashed border-line-strong px-4 py-3">
        <p className="text-sm text-ink-secondary">Students mark this checkpoint complete. Add a question to make it a quick retrieval check with instant feedback.</p>
        <Button variant="quiet" size="sm" className="mt-2" onClick={() => onChange(emptyCheck())}><Plus className="h-4 w-4" />Question</Button>
      </div>
    )
  }
  const update = (patch: Partial<CheckDraft>) => onChange({ ...check, ...patch })
  return (
    <fieldset className="grid gap-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-secondary">Retrieval question</legend>
      {attempts > 0 && <p className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink">{attempts} {attempts === 1 ? 'student has' : 'students have'} answered this question, so it's locked to keep their results. Add a new checkpoint to ask something different.</p>}
      <label className="block text-sm font-semibold text-ink-secondary">Question
        <textarea value={check.prompt} readOnly={locked} onChange={(event) => update({ prompt: event.target.value })} rows={2} placeholder="Which branch runs when age is 12?" className="app-control mt-1 block w-full" />
      </label>
      <div>
        <p className="text-sm font-semibold text-ink-secondary">Choices and correct answer</p>
        <div className="mt-2 grid gap-2">
          {check.options.map((option, optionIndex) => (
            <div key={optionIndex} className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
              <label className="flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-sunken" title="Correct answer">
                <input type="radio" name={`${idBase}-correct`} aria-label={`Choice ${optionIndex + 1} is correct`} checked={check.correct_option === optionIndex} disabled={locked} onChange={() => update({ correct_option: optionIndex })} className="h-4 w-4 accent-action-primary" />
              </label>
              <input aria-label={`Choice ${optionIndex + 1}`} value={option} readOnly={locked} onChange={(event) => update({ options: check.options.map((item, itemIndex) => itemIndex === optionIndex ? event.target.value : item) })} placeholder={`Choice ${optionIndex + 1}`} className="app-control min-w-0" />
              <IconButton label={`Remove choice ${optionIndex + 1}`} disabled={locked || check.options.length <= 2} onClick={() => update({
                options: check.options.filter((_, itemIndex) => itemIndex !== optionIndex),
                correct_option: check.correct_option === optionIndex ? 0 : check.correct_option > optionIndex ? check.correct_option - 1 : check.correct_option,
              })}><X className="h-4 w-4" /></IconButton>
            </div>
          ))}
        </div>
        {!locked && <Button variant="quiet" size="sm" className="mt-2" disabled={check.options.length >= 6} onClick={() => update({ options: [...check.options, ''] })}><Plus className="h-4 w-4" />Choice</Button>}
      </div>
      <label className="block text-sm font-semibold text-ink-secondary">Explanation shown after answering
        <textarea value={check.explanation} readOnly={locked} onChange={(event) => update({ explanation: event.target.value })} rows={2} placeholder="12 isn't under 12, so the else branch runs." className="app-control mt-1 block w-full" />
      </label>
      {!locked && <Button variant="quiet" size="sm" className="justify-self-start" onClick={() => onChange(null)}><Trash2 className="h-4 w-4" />Remove question</Button>}
    </fieldset>
  )
}
