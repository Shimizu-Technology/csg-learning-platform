import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, CalendarRange, ChevronLeft, CircleCheck, CircleDot, Copy, Eye, History, Layers, Link2, LoaderCircle, Lock, Pencil, PencilLine, RotateCcw, Save, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { cohortPath, curriculumPath, lessonEditorPath, lessonRecordPath, moduleRecordPath } from '../../lib/routes'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useBackLink, type BackLink } from '../../lib/recordOrigin'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useUpload } from '../../contexts/UploadContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { LearningObjectivesPanel } from '../../components/shared/LearningObjectivesPanel'
import { Modal } from '../../components/shared/Modal'
import { Button, IconButton } from '../../components/ui/Button'
import { OverflowMenu } from '../../components/ui/OverflowMenu'
import type { LearningObjective, LessonBlockEditorResponse, LessonDetail, LessonEditAccess, LessonObjective, Rubric } from '../../types/api'
import { cohortList, copyNotice, grantLine, readOnlyNotice } from '../../lib/lessonEditing'
import { CopyForCohortAction } from './lessonEditor/CopyForCohortDialog'
import type { CurriculumCopyResponse } from '../../types/api'
import { MoveLessonDialog } from './lessonEditor/MoveLessonDialog'
import { AddBlockMenu } from './lessonEditor/AddBlockMenu'
import { BlockCard } from './lessonEditor/BlockCard'
import { Inspector, type InspectorTab } from './lessonEditor/Inspector'
import { LessonLeaveGuard } from './lessonEditor/LessonLeaveGuard'
import {
  BLOCK_LABELS, MAX_BLOCKS, applySavedIds, blockFromServer, blockTitle, draftFromLesson, draftPayload, draftProblems, draftSignature,
  duplicateBlock, insertBlock, moveBlock, newBlock, previewBlock, rekeyNewBlocks, removeBlock, type BlockDraft, type BlockType, type LessonDraft,
} from './lessonEditor/blockDraft'
import { clearLocalDraft, localDraftGeneration, localDraftKey, localDraftText, readLocalDraft, writeLocalDraft, type LocalDraftBackup } from './lessonEditor/localDraft'

type SaveStatus = 'idle' | 'saving' | 'error' | 'conflict'
/** How long typing pauses before the local crash backup is written. */
const BACKUP_DELAY_MS = 400
const PENDING_UPLOAD = new Set(['queued', 'presigning', 'uploading', 'saving'])

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

function savedAgo(savedAt: number, now: number) {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000))
  if (seconds < 60) return `${Math.max(seconds, 1)}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function weekdayLabel(response: LessonBlockEditorResponse, releaseDay: number) {
  const day = response.context.module.release_days.find((item) => item.release_day === releaseDay)
  return day ? `Week ${day.week}, ${day.day_name.slice(0, 3)}` : `Week ${Math.floor(releaseDay / 7) + 1}`
}

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const lessonId = Number(id)
  // Back goes where the editor was opened from (Content, the lesson page, Grading…), remembered for
  // this tab across round trips; with no history, to the lesson's own page (L-3.1, spec §4.2).
  const back = useBackLink({ returnTo: lessonRecordPath(lessonId), returnLabel: 'lesson' }, { scope: `lesson-editor:${id}` })
  const { user } = useAuthContext()
  if (!user) return <LoadingSpinner message="Loading lesson…" />
  // Staff open the editor; the API says whether this person may save (access).
  return <BlockLessonEditor key={lessonId} lessonId={lessonId} back={back} backupKey={localDraftKey(user.id, lessonId)} isAdmin={Boolean(user.is_admin)} />
}

/*
 * Edits stay in this page until the person chooses Save (README 9.7): lesson
 * rows are live for every cohort on the curriculum, so half-typed text must
 * never reach students on its own. A local backup covers crashes.
 */
function BlockLessonEditor({ lessonId, back, backupKey, isAdmin }: { lessonId: number; back: BackLink; backupKey: string; isAdmin: boolean }) {
  const backTo = back.to
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const previewing = searchParams.get('preview') === 'true'
  const { uploads, completeDeferredUpload } = useUpload()

  const [server, setServer] = useState<LessonBlockEditorResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<LessonDraft | null>(null)
  const draftRef = useRef<LessonDraft | null>(null)
  const setDraft = useCallback((update: (current: LessonDraft) => LessonDraft) => {
    setDraftState((current) => {
      if (!current) return current
      const next = update(current)
      draftRef.current = next
      return next
    })
  }, [])

  const updatedAtRef = useRef('')
  const baselineRef = useRef(new Map<number, BlockDraft>())
  const [savedSig, setSavedSigState] = useState('')
  const savedSigRef = useRef('')
  const setSavedSig = useCallback((next: string) => {
    savedSigRef.current = next
    setSavedSigState(next)
  }, [])
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [status, setStatusState] = useState<SaveStatus>('idle')
  const statusRef = useRef<SaveStatus>('idle')
  const setStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Saves run one at a time, in the order asked for. */
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const [restorable, setRestorable] = useState<LocalDraftBackup | null>(null)
  /**
   * The backup was looked for on a load that allowed editing. Until then (and
   * whenever editing access is off) the backup is left alone: a read-only
   * visit must not clear edits the person couldn't save.
   */
  const [backupChecked, setBackupChecked] = useState(false)
  const [readOnlyBackup, setReadOnlyBackup] = useState<LocalDraftBackup | null>(null)

  const [objectives, setObjectives] = useState<LearningObjective[]>([])
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const auditBlockId = Number(searchParams.get('block'))
  const auditRequest = useRef({ blockId: auditBlockId, companion: searchParams.get('add_companion') === '1' })
  const [suggestedSubmission, setSuggestedSubmission] = useState(searchParams.get('suggest_submission'))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('lesson')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<BlockDraft | null>(null)
  const [reopen, setReopen] = useState<{ impact: LessonBlockEditorResponse['completion_impact']; watchReset?: number[] } | null>(null)
  const [watchReset, setWatchReset] = useState<{ ids: number[]; message: string } | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [drag, setDrag] = useState<{ key: string; target: number | null; side: 'before' | 'after' } | null>(null)
  const now = useNow(5000)

  const hydrate = useCallback((response: LessonBlockEditorResponse, keys?: Map<number, string>) => {
    const next = draftFromLesson(response.lesson, keys)
    draftRef.current = next
    setDraftState(next)
    setServer(response)
    updatedAtRef.current = response.lesson.updated_at
    baselineRef.current = new Map(next.blocks.map((block) => [block.id!, block]))
    setSavedSig(draftSignature(next))
    setStatus('idle')
    setSaveError(null)
  }, [setSavedSig, setStatus])

  const loadVersion = useRef(0)
  const load = useCallback(async () => {
    const version = ++loadVersion.current
    const response = await api.getLessonBlockEditor(lessonId)
    if (version !== loadVersion.current) return
    if (!response.data) {
      setLoadError(response.error || 'This lesson couldn\'t be loaded.')
      return
    }
    const firstLoad = !draftRef.current
    const editable = response.data.access.can_edit
    hydrate(response.data, draftRef.current ? new Map(draftRef.current.blocks.filter((block) => block.id).map((block) => [block.id!, block.key])) : undefined)
    if (!editable) {
      setBackupChecked(false)
      setReadOnlyBackup(readLocalDraft(backupKey))
    } else if (firstLoad) {
      const backup = readLocalDraft(backupKey)
      if (backup && draftSignature(backup.draft) !== draftSignature(draftFromLesson(response.data.lesson))) setRestorable(backup)
      else if (backup) clearLocalDraft(backupKey)
      setReadOnlyBackup(null)
      setBackupChecked(true)
    }
    if (firstLoad) {
      const blockId = auditRequest.current.blockId
      const block = draftRef.current?.blocks.find((item) => item.id === blockId)
      if (block) {
        if (editable && auditRequest.current.companion && draftRef.current!.blocks.length < MAX_BLOCKS && !['exercise', 'code_challenge', 'checkpoint'].includes(block.block_type)) {
          auditRequest.current.companion = false
          const companion = newBlock('exercise')
          companion.title = `Exercise: ${block.title || 'Your work'}`
          companion.body = block.body || 'Describe the work learners should submit.'
          companion.submission_type = 'text_submission'
          setDraft((current) => ({ ...current, blocks: insertBlock(current.blocks, current.blocks.findIndex((item) => item.key === block.key) + 1, companion) }))
          setSelectedKey(companion.key)
        } else setSelectedKey(block.key)
        setInspectorTab('block')
        if (window.innerWidth < 1024) setSettingsOpen(true)
      }
    }
    const curriculumId = response.data.lesson.curriculum_id
    if (!editable) return
    void api.getLearningObjectives(curriculumId).then((result) => { if (result.data) setObjectives(result.data.learning_objectives) })
    void api.getRubrics(curriculumId).then((result) => { if (result.data) setRubrics(result.data.rubrics) })
  }, [backupKey, hydrate, lessonId, setDraft])

  useEffect(() => {
    void load()
  }, [load])

  const activity = useMemo(() => new Map((server?.block_activity || []).map((row) => [row.content_block_id, row])), [server])
  const problems = useMemo(() => (draft ? draftProblems(draft) : new Map<string, string>()), [draft])
  const firstProblem = problems.size ? [...problems.values()][0] : null
  const signature = useMemo(() => (draft ? draftSignature(draft) : ''), [draft])
  const pendingUploads = useMemo(() => new Set(uploads
    .filter((upload) => upload.contentBlockId && PENDING_UPLOAD.has(upload.status))
    .map((upload) => upload.contentBlockId as number)), [uploads])
  const dirty = Boolean(draft) && signature !== savedSig
  useEffect(() => {
    if (dirty || !savedAt || (!searchParams.has('suggest_submission') && !searchParams.has('add_companion'))) return
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('suggest_submission')
      next.delete('add_companion')
      return next
    }, { replace: true })
  }, [dirty, savedAt, searchParams, setSearchParams])

  const saving = status === 'saving'

  // What a save reads when it starts, not when it was asked for.
  const live = useRef({ activity, pendingUploads, uploads, completeDeferredUpload, completionImpact: server?.completion_impact })
  useEffect(() => {
    live.current = { activity, pendingUploads, uploads, completeDeferredUpload, completionImpact: server?.completion_impact }
  }, [activity, completeDeferredUpload, pendingUploads, uploads, server?.completion_impact])

  // One save at a time. Each builds its payload and base version when it
  // starts, so a save queued behind another sends the newest edits on top of
  // the version the first one produced.
  const runSave = useCallback(async (confirmWatchReset?: number[], confirmReopenCount?: number): Promise<boolean> => {
    const sent = draftRef.current
    if (!sent) return false
    if (statusRef.current === 'conflict') return false
    if (!confirmWatchReset?.length && draftSignature(sent) === savedSigRef.current) return true
    const blockingProblem = [...draftProblems(sent).values()][0]
    if (blockingProblem) {
      setSaveError(blockingProblem)
      return false
    }
    const { activity: currentActivity, pendingUploads: uploading, uploads: currentUploads, completeDeferredUpload: completeUpload } = live.current
    const payload = draftPayload(sent, { baseUpdatedAt: updatedAtRef.current, baseline: baselineRef.current, pendingUploads: uploading, confirmWatchReset })
    const addsWork = sent.blocks.some((block) => !block.id && ['exercise', 'code_challenge', 'checkpoint'].includes(block.block_type))
    const impact = live.current.completionImpact
    if (addsWork && !impact) {
      setSaveError('The completion impact is unavailable. Reload the lesson before adding new work.')
      setStatus('error')
      return false
    }
    if (addsWork && impact && impact.completed_learners > 0 && confirmReopenCount === undefined) {
      setReopen({ impact, watchReset: confirmWatchReset })
      return false
    }
    if (confirmReopenCount !== undefined) payload.confirm_reopen_completed_count = confirmReopenCount
    setStatus('saving')
    setSaveError(null)
    const response = await api.saveLessonBlockEditor(lessonId, payload)
    if (!response.data) {
      const message = response.error || 'The lesson didn\'t save.'
      if (response.status === 409) {
        setStatus('conflict')
        setSaveError(message)
        return false
      }
      if (response.errorCode === 'confirm_reopen_completed' && response.errorCompletionImpact) {
        setReopen({ impact: response.errorCompletionImpact, watchReset: confirmWatchReset })
        setStatus('idle')
        return false
      }
      if (response.errorCode === 'confirm_watch_reset') {
        // The server names the blocks; the fallback covers an older API.
        const playing = (block?: { s3_video_key?: string | null; video_url?: string | null }) => block?.s3_video_key || block?.video_url?.trim() || null
        const ids = response.errorBlockIds?.length ? response.errorBlockIds : sent.blocks.filter((block) => block.id && playing(block) !== playing(baselineRef.current.get(block.id)) &&
          ((currentActivity.get(block.id)?.progress || 0) > 0 || (currentActivity.get(block.id)?.watched || 0) > 0)).map((block) => block.id!)
        setWatchReset({ ids, message })
        setStatus('idle')
        return false
      }
      setStatus('error')
      setSaveError(message)
      return false
    }
    const saved = response.data
    const savedLesson = saved.lesson
    const savedBlocks = new Map(savedLesson.content_blocks.map((block) => [block.id, block]))
    // Blocks whose upload is still running were sent without the new video: record what the server holds.
    const sentWithIds = applySavedIds(sent, sent, savedLesson)
    const settled: LessonDraft = {
      ...sentWithIds,
      blocks: sentWithIds.blocks.map((block) => {
        const onServer = block.id ? savedBlocks.get(block.id) : undefined
        return onServer && block.id && uploading.has(block.id)
          ? { ...block, s3_video_key: onServer.s3_video_key || null, s3_video_content_type: onServer.s3_video_content_type || null, s3_video_size: onServer.s3_video_size ?? null }
          : block
      }),
    }
    updatedAtRef.current = savedLesson.updated_at
    baselineRef.current = new Map(settled.blocks.filter((block) => block.id).map((block) => [block.id!, { ...block, ...(savedBlocks.get(block.id!) ? { s3_video_key: savedBlocks.get(block.id!)!.s3_video_key || null, video_segments: blockFromServer(savedBlocks.get(block.id!)!).video_segments } : {}) }]))
    setServer(saved)
    setSavedSig(draftSignature(settled))
    setSavedAt(Date.now())
    setSuggestedSubmission(null)
    setStatus('idle')
    setDraft((current) => applySavedIds(current, sent, savedLesson))
    for (const upload of currentUploads) {
      if (upload.deferPersistence && upload.status === 'waiting' && upload.contentBlockId && savedBlocks.get(upload.contentBlockId)?.s3_video_key === upload.s3Key) {
        completeUpload(upload.id)
      }
    }
    return true
  }, [lessonId, setDraft, setSavedSig, setStatus])

  const save = useCallback((confirmWatchReset?: number[], confirmReopenCount?: number): Promise<boolean> => {
    const next = saveQueueRef.current.then(() => runSave(confirmWatchReset, confirmReopenCount), () => runSave(confirmWatchReset, confirmReopenCount))
    saveQueueRef.current = next.catch(() => undefined)
    return next
  }, [runSave])

  // Crash backup in this browser while edits are unsaved; never sent on its own.
  const canEdit = Boolean(server?.access.can_edit)
  useEffect(() => {
    // Before the first editable load there's nothing to compare and the backup
    // hasn't been read; without editing access it is kept for later.
    if (restorable || !draft || !canEdit || !backupChecked) return
    if (!dirty) {
      clearLocalDraft(backupKey)
      return
    }
    // A sign-out before the timer fires cancels this write (localDraftGeneration).
    const scheduledIn = localDraftGeneration()
    const timer = window.setTimeout(() => writeLocalDraft(backupKey, { savedAt: Date.now(), baseUpdatedAt: updatedAtRef.current, draft }, scheduledIn), BACKUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [backupChecked, backupKey, canEdit, dirty, draft, restorable])

  const restoreBackup = () => {
    if (!restorable) return
    const restored = rekeyNewBlocks(restorable.draft)
    setDraft(() => restored)
    setRestorable(null)
    setAnnouncement('Restored your unsaved changes. Save to keep them.')
  }
  const dismissBackup = () => {
    clearLocalDraft(backupKey)
    setRestorable(null)
  }

  // ⌘S / Ctrl+S saves now.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && status !== 'conflict') void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, save, status])

  const blocks = draft?.blocks || []
  const selectedBlock = blocks.find((block) => block.key === selectedKey) || null
  const canAdd = blocks.length < MAX_BLOCKS

  const updateBlock = useCallback((key: string, patch: Partial<BlockDraft>) => {
    setDraft((current) => ({ ...current, blocks: current.blocks.map((block) => block.key === key ? { ...block, ...patch } : block) }))
  }, [setDraft])

  const focusBlock = (key: string, selector = 'button[aria-label^="Move"]') => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block-key="${key}"] ${selector}`)?.focus())
  }

  const move = (from: number, to: number, refocus = true) => {
    const block = blocks[from]
    if (!block || to < 0 || to >= blocks.length) return
    setDraft((current) => ({ ...current, blocks: moveBlock(current.blocks, from, to) }))
    setAnnouncement(`Moved ${BLOCK_LABELS[block.block_type].toLowerCase()} block to position ${to + 1} of ${blocks.length}.`)
    if (refocus) focusBlock(block.key)
  }

  const add = (index: number, type: BlockType) => {
    if (!canAdd) return
    const block = newBlock(type)
    setDraft((current) => ({ ...current, blocks: insertBlock(current.blocks, index, block) }))
    setSelectedKey(block.key)
    setInspectorTab('block')
    setAnnouncement(`Added a ${BLOCK_LABELS[type].toLowerCase()} block at position ${index + 1}.`)
    focusBlock(block.key, 'input, [contenteditable="true"], textarea')
  }

  const duplicate = (index: number) => {
    if (!canAdd) return
    const copy = duplicateBlock(blocks[index])
    setDraft((current) => ({ ...current, blocks: insertBlock(current.blocks, index + 1, copy) }))
    setSelectedKey(copy.key)
    setAnnouncement(`Duplicated the ${BLOCK_LABELS[copy.block_type].toLowerCase()} block.`)
    focusBlock(copy.key)
  }

  const isEmpty = (block: BlockDraft) => !block.title.trim() && !block.body.trim() && !block.video_url.trim() && !block.s3_video_key && !block.check && !block.solution.trim()
  const requestDelete = (block: BlockDraft) => {
    if (block.id === null && isEmpty(block)) {
      deleteBlock(block)
      return
    }
    setPendingDelete(block)
  }
  const deleteBlock = (block: BlockDraft) => {
    const index = blocks.findIndex((item) => item.key === block.key)
    setDraft((current) => removeBlock(current, block.key))
    setPendingDelete(null)
    if (selectedKey === block.key) {
      setSelectedKey(null)
      setInspectorTab('lesson')
    }
    setAnnouncement(`Deleted the ${BLOCK_LABELS[block.block_type].toLowerCase()} block.`)
    const neighbour = blocks[index + 1] || blocks[index - 1]
    if (neighbour) focusBlock(neighbour.key)
  }

  // The dragged block lives in a ref: dragover fires before React re-renders after dragstart.
  const dragRef = useRef<{ key: string; target: number | null; side: 'before' | 'after' } | null>(null)
  const setDragState = (next: typeof dragRef.current) => {
    dragRef.current = next
    setDrag(next)
  }
  const onDragStart = (key: string) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
    const card = (event.currentTarget as HTMLElement).closest('article')
    if (card) event.dataTransfer.setDragImage(card, 24, 24)
    setDragState({ key, target: null, side: 'before' })
  }
  const onDragOver = (index: number) => (event: DragEvent<HTMLElement>) => {
    const current = dragRef.current
    if (!current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (current.target !== index || current.side !== side) setDragState({ ...current, target: index, side })
  }
  const onDrop = (index: number) => (event: DragEvent<HTMLElement>) => {
    const current = dragRef.current
    if (!current) return
    event.preventDefault()
    const from = blocks.findIndex((block) => block.key === current.key)
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    let to = side === 'after' ? index + 1 : index
    if (from < to) to -= 1
    setDragState(null)
    if (from >= 0 && from !== to) move(from, to, false)
  }

  const archive = async (restore: boolean) => {
    if (!server) return
    if (dirty && !(await save())) return
    const response = restore ? await api.restoreLesson(lessonId, updatedAtRef.current) : await api.archiveLesson(lessonId, updatedAtRef.current)
    setConfirmArchive(false)
    if (response.error) {
      toast.error(response.error)
      return
    }
    toast.success(restore ? 'Lesson restored. Students can see it again.' : 'Lesson archived. Its content and student work are kept.')
    await load()
  }

  const duplicateLesson = async () => {
    if (dirty && !(await save())) return
    setConfirmDuplicate(false)
    const response = await api.duplicateLesson(lessonId)
    if (!response.data) {
      toast.error(response.error || 'The lesson couldn\'t be duplicated.')
      return
    }
    toast.success('Copy created. It starts archived, so students don\'t see it until you restore it.')
    navigate(lessonEditorPath(response.data.lesson.id))
  }

  const openMove = async () => {
    if (dirty && !(await save())) return
    setMoveOpen(true)
  }

  const setPreview = (on: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (on) next.set('preview', 'true')
    else next.delete('preview')
    setSearchParams(next, { replace: true })
  }

  const objectiveCode = (objectiveId: number | null) => objectives.find((objective) => objective.id === objectiveId)?.code || null
  const previewObjectives: LessonObjective[] = (draft?.alignments || []).flatMap((alignment, index) => {
    const objective = objectives.find((item) => item.id === alignment.learning_objective_id)
    if (!objective) return []
    const block = blocks.find((item) => item.key === alignment.block_key)
    return [{ alignment_id: -(index + 1), id: objective.id, code: objective.code, title: objective.title, description: objective.description, success_criteria: objective.success_criteria, active: objective.active, content_block_id: block?.id ?? null, content_block_title: block?.title || null }]
  })

  if (loadError) {
    return (
      <div className="app-page space-y-4">
        <Link to={backTo} state={RESTORE_LIST_STATE} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken hover:text-ink"><ChevronLeft className="h-4 w-4" />{back.label}</Link>
        <p role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-ink">{loadError}</p>
      </div>
    )
  }
  if (!server || !draft) return <LoadingSpinner message="Loading lesson…" />
  // After "Make a copy for this cohort", reopen this lesson in the cohort's copy.
  const openCopy = async (copy: CurriculumCopyResponse['curriculum_copy']) => {
    const copied = copy.lesson_ids[String(lessonId)]
    toast.success(copy.already_copied ? `Opened ${copy.cohort.name}'s copy` : `Made ${copy.cohort.name}'s copy`)
    navigate(copied ? lessonEditorPath(copied) : `/admin/content?curriculum=${copy.copy_curriculum.id}&pane=detail`, { replace: true })
  }
  if (!server.access.can_edit) return <ReadOnlyLesson lesson={server.lesson} access={server.access} back={back} context={server.context} backup={readOnlyBackup} onCopied={openCopy} />

  const lesson = server.lesson
  const context = server.context
  const otherCohorts = context.used_in
  // Cohorts you don't teach still share the curriculum: counted, never named (L-3.2).
  const sharingCount = otherCohorts.length + (context.other_cohorts_count ?? 0)
  const copied = copyNotice(server.access)
  const saveState = status === 'saving' ? { icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />, text: 'Saving…', tone: 'text-ink-muted' }
    : status === 'conflict' ? { icon: <TriangleAlert className="h-3.5 w-3.5" />, text: 'Not saved: newer version', tone: 'text-danger-ink' }
      : status === 'error' && dirty ? { icon: <TriangleAlert className="h-3.5 w-3.5" />, text: 'Couldn\'t save', tone: 'text-danger-ink' }
        : dirty && problems.size ? { icon: <CircleDot className="h-3.5 w-3.5" />, text: 'Unsaved: finish a block', tone: 'text-warning-ink' }
          : dirty ? { icon: <CircleDot className="h-3.5 w-3.5" />, text: 'Unsaved changes', tone: 'text-warning-ink' }
            : { icon: <CircleCheck className="h-3.5 w-3.5" />, text: savedAt ? `Saved · ${savedAgo(savedAt, now)}` : 'Saved', tone: 'text-ink-muted' }

  const inspector = (
    <Inspector
      tab={selectedBlock ? inspectorTab : 'lesson'}
      onTab={setInspectorTab}
      draft={draft}
      onLesson={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      block={selectedBlock}
      onBlock={(patch) => selectedBlock && updateBlock(selectedBlock.key, patch)}
      activity={activity}
      context={context}
      curriculumId={lesson.curriculum_id}
      lessonId={lessonId}
      objectives={objectives}
      onObjectiveCreated={(objective) => setObjectives((current) => [...current, objective])}
      rubrics={rubrics}
      onRubricCreated={(rubric) => setRubrics((current) => [...current, rubric])}
    />
  )

  return (
    <div className="-mx-4 -mt-4 flex flex-col sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8">
      {suggestedSubmission && selectedBlock?.id === auditBlockId && <p role="status" className="border-b border-line bg-surface-sunken p-4 text-sm text-ink">Suggested submission: {({ text_submission: 'Text submission', repo_url_submission: 'Repository link', repo_and_live_url_submission: 'Repository and live links' } as Record<string, string>)[suggestedSubmission] || 'Choose a submission type'}. Review the block settings and save your decision. Opening this suggestion does not change the block.</p>}
      <LessonLeaveGuard dirty={dirty || saving} onSave={() => save()} onDiscard={() => clearLocalDraft(backupKey)} problem={firstProblem} />
      <p aria-live="polite" className="sr-only">{announcement}</p>

      <header className="sticky top-14 z-30 flex min-h-15 items-center gap-2 border-b border-line bg-surface-raised px-2 py-2 sm:gap-3 sm:px-5 lg:top-0">
        <Link to={backTo} state={RESTORE_LIST_STATE} aria-label={back.label} data-back-link="" className="inline-flex min-h-11 max-w-[14rem] shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink">
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="hidden truncate md:inline">{back.label}</span>
        </Link>
        <div className="min-w-0 flex-1">
          {/* Curriculum › Module › Lesson (L-3.1): each opens its staff record page. */}
          <nav aria-label="Breadcrumb" className="hidden truncate text-xs text-ink-muted md:block">
            <Link to={curriculumPath(context.curriculum.id)} className="hover:text-ink hover:underline">{context.curriculum.name}</Link>
            <span aria-hidden="true"> › </span>
            <Link to={moduleRecordPath(context.module.id)} className="hover:text-ink hover:underline">{context.module.name}</Link>
            <span aria-hidden="true"> › </span>
            <Link to={lessonRecordPath(lessonId)} className="hover:text-ink hover:underline">{lesson.title}</Link>
            <span aria-hidden="true"> · </span>
            <span>{weekdayLabel(server, draft.release_day)}</span>
          </nav>
          <h1 className="truncate text-[15px] font-bold text-ink" title={draft.title}>{draft.title.trim() || 'Untitled lesson'}</h1>
        </div>
        <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold sm:text-[13px] ${saveState.tone}`}>
          {saveState.icon}<span className="max-sm:sr-only">{saveState.text}</span>
        </span>
        <Button
          size="sm"
          className="min-w-11 shrink-0"
          onClick={() => void save()}
          disabled={!dirty || saving || status === 'conflict' || problems.size > 0}
          aria-keyshortcuts="Meta+S Control+S"
          title="Save (⌘S / Ctrl+S)"
        >
          <Save className="h-4 w-4" aria-hidden="true" /><span className="max-sm:sr-only">Save</span>
        </Button>
        {!previewing && (
          <IconButton label="Settings" size="sm" className="lg:hidden" onClick={() => setSettingsOpen(true)}><SlidersHorizontal className="h-4 w-4" /></IconButton>
        )}
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setPreview(!previewing)} aria-pressed={previewing}>
          {previewing ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}<span className="max-sm:sr-only">{previewing ? 'Edit' : 'Preview'}</span>
        </Button>
        <OverflowMenu
          label="More lesson actions"
          size="sm"
          items={[
            // Lesson structure (duplicate, move, archive) stays admin-only.
            ...(isAdmin ? [
              { key: 'duplicate', label: 'Duplicate lesson', icon: <Copy />, onSelect: () => setConfirmDuplicate(true) },
              ...(lesson.archived_at ? [] : [{ key: 'move', label: 'Move to week or day', icon: <CalendarRange />, onSelect: () => void openMove() }]),
            ] : []),
            { key: 'copy', label: 'Copy link', icon: <Link2 />, onSelect: () => void copyText(`${window.location.origin}${lessonEditorPath(lessonId)}`).then(() => toast.success('Link copied')) },
            ...(!isAdmin ? [] : lesson.archived_at
              ? [{ key: 'restore', label: 'Restore lesson', icon: <RotateCcw />, onSelect: () => void archive(true) }]
              : [{ key: 'archive', label: 'Archive lesson', icon: <Archive />, onSelect: () => setConfirmArchive(true), tone: 'danger' as const }]),
          ]}
        />
      </header>

      {(status === 'conflict' || (status === 'error' && saveError)) && (
        <div role="alert" className="flex flex-col gap-3 border-b border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-ink sm:flex-row sm:items-center sm:px-6">
          <p className="min-w-0 flex-1">{saveError}</p>
          {status === 'conflict'
            ? <Button size="sm" variant="secondary" onClick={() => { draftRef.current = null; void load() }}>Reload latest version</Button>
            : <Button size="sm" variant="secondary" onClick={() => void save()}>Try again</Button>}
        </div>
      )}

      {restorable && (
        <div role="status" className="flex flex-col gap-3 border-b border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink sm:flex-row sm:items-center sm:px-6">
          <History className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
          {restorable.baseUpdatedAt === updatedAtRef.current ? (
            <>
              <p className="min-w-0 flex-1">This browser kept changes you didn't save ({savedAgo(restorable.savedAt, now)}). Restore them to review and save, or discard them.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={dismissBackup}>Discard</Button>
                <Button size="sm" onClick={restoreBackup}>Restore changes</Button>
              </div>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1">This browser kept changes you didn't save ({savedAgo(restorable.savedAt, now)}), but the lesson was saved since then, so they can't be restored over it.</p>
              <Button size="sm" variant="secondary" onClick={dismissBackup}>Dismiss</Button>
            </>
          )}
        </div>
      )}

      {lesson.archived_at && (
        <div className="flex flex-col gap-3 border-b border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink sm:flex-row sm:items-center sm:px-6">
          <p className="min-w-0 flex-1"><strong>Archived lesson.</strong> Students can't see it. Its content, progress and submissions are kept.</p>
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => void archive(true)}><RotateCcw className="h-4 w-4" />Restore lesson</Button>}
        </div>
      )}

      {previewing ? (
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
          <p className="rounded-xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">This is how students see the lesson, including changes that haven't saved yet.</p>
          <div className="app-surface p-4 sm:p-6">
            <h2 className="text-xl font-bold text-ink">{draft.title.trim() || 'Untitled lesson'}</h2>
            <p className="mt-1 text-sm text-ink-muted">{weekdayLabel(server, draft.release_day)}{draft.required ? '' : ' · Optional'}</p>
          </div>
          <LearningObjectivesPanel objectives={previewObjectives} preview />
          <div className="space-y-4" data-testid="lesson-preview">
            {blocks.map((block, index) => (
              <ContentBlockRenderer key={block.key} block={previewBlock(block, index, objectiveCode)} isStaff={false} lessonReturn={{ url: `${window.location.origin}${lessonEditorPath(lessonId, { preview: true })}`, label: draft.title }} starterOpensNewTab />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 px-3 pb-16 pt-5 sm:px-6">
            <div className="mx-auto max-w-[720px]">
              {server.access.reason === 'granted' && (
                <div className="mb-4 flex gap-3 rounded-2xl border border-success-line bg-success-soft px-4 py-3 text-sm text-success-ink">
                  <PencilLine className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p><strong>You can edit {cohortList(server.access.grants.map((grant) => grant.cohort.name))}'s lessons.</strong> {server.access.grants[0] ? `${grantLine(server.access.grants[0])}.` : ''} Students see your changes when you save.</p>
                </div>
              )}
              {copied && (
                <div role="status" className="mb-4 flex gap-3 rounded-2xl border border-success-line bg-success-soft px-4 py-3 text-sm text-success-ink">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p><strong>{copied.title}.</strong> {copied.body}</p>
                </div>
              )}
              {sharingCount > 1 && (
                <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink sm:flex-row sm:items-start">
                  <Layers className="mt-0.5 hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                  <p className="min-w-0 flex-1"><strong>{sharingCount} cohorts use this curriculum.</strong> Changes here show up for {cohortList([...otherCohorts.map((cohort) => cohort.name), ...(context.other_cohorts_count ? [`${context.other_cohorts_count} ${context.other_cohorts_count === 1 ? 'cohort' : 'cohorts'} you don't teach`] : [])])}. To change it for one cohort only, make a copy first.</p>
                  {lesson.curriculum_id && <CopyForCohortAction variant="secondary" className="shrink-0" curriculumId={lesson.curriculum_id} cohorts={server.access.copy_cohorts ?? []} onCopied={openCopy}
                    disabledReason={dirty || saving ? 'Save or discard your changes first' : null} />}
                </div>
              )}
              <p className="mb-1 text-xs font-semibold text-ink-muted tabular-nums">{blocks.length} {blocks.length === 1 ? 'block' : 'blocks'} · students see them in this order</p>
              <AddBlockMenu label="Add block at the start" onAdd={(type) => add(0, type)} disabled={!canAdd} disabledReason="A lesson can have at most 20 blocks" />
              {blocks.map((block, index) => (
                <Fragment key={block.key}>
                  <BlockCard
                    block={block}
                    index={index}
                    total={blocks.length}
                    lessonId={lessonId}
                    activity={block.id ? activity.get(block.id) : undefined}
                    selected={selectedKey === block.key}
                    problem={problems.get(block.key)}
                    dropIndicator={drag && drag.target === index && drag.key !== block.key ? drag.side : null}
                    onSelect={() => {
                      if (selectedKey !== block.key) {
                        setSelectedKey(block.key)
                        setInspectorTab('block')
                      }
                    }}
                    onChange={(patch) => updateBlock(block.key, patch)}
                    onMove={(to) => move(index, to)}
                    onDuplicate={() => duplicate(index)}
                    onDelete={() => requestDelete(block)}
                    onDragStart={onDragStart(block.key)}
                    onDragOver={onDragOver(index)}
                    onDrop={onDrop(index)}
                    onDragEnd={() => setDragState(null)}
                    canDuplicate={canAdd}
                  />
                  <AddBlockMenu
                    label={index === blocks.length - 1 ? 'Add block at the end' : `Add block after block ${index + 1}`}
                    onAdd={(type) => add(index + 1, type)}
                    disabled={!canAdd}
                    disabledReason="A lesson can have at most 20 blocks"
                  />
                </Fragment>
              ))}
            </div>
          </main>
          <aside aria-label="Settings" className="hidden w-80 shrink-0 border-l border-line bg-surface-raised lg:block">
            <div className="sticky top-15 max-h-[calc(100dvh-7.75rem)] overflow-y-auto">{inspector}</div>
          </aside>
        </div>
      )}

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" size="md">
        <div className="-mx-4 -my-2 sm:-mx-6">{inspector}</div>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        size="md"
        title={pendingDelete ? `Delete the ${BLOCK_LABELS[pendingDelete.block_type].toLowerCase()} block?` : 'Delete block?'}
        subtitle={pendingDelete ? `"${blockTitle(pendingDelete)}" is removed from the lesson when you save. Students haven't done any work on it.` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setPendingDelete(null)}>Keep block</Button>
          <Button variant="danger" onClick={() => pendingDelete && deleteBlock(pendingDelete)}>Delete block</Button>
        </>}
      />

      <Modal open={Boolean(reopen)} onClose={() => setReopen(null)} title="Reopen finished lessons?" subtitle={reopen ? `${reopen.impact.completed_learners} ${reopen.impact.completed_learners === 1 ? 'learner' : 'learners'} finished this lesson. Adding new work reopens it for them until they finish that work.` : ''} size="md" footer={<>
        <Button variant="secondary" onClick={() => setReopen(null)}>Keep editing</Button>
        <Button variant="danger" onClick={() => { const warning = reopen; setReopen(null); if (warning) void save(warning.watchReset, warning.impact.completed_learners) }}>Add work and reopen</Button>
      </>}>
        <ul className="space-y-2 text-sm text-ink-muted">{reopen?.impact.cohorts.map((cohort) => <li key={cohort.id}><Link className="app-link" to={cohortPath(cohort.id)}>{cohort.name}</Link>: {cohort.completed_learners} {cohort.completed_learners === 1 ? 'learner' : 'learners'}</li>)}</ul>
        {Boolean(reopen?.impact.other_cohorts_completed_learners) && <p className="mt-2 text-sm text-ink-muted">Other cohorts: {reopen?.impact.other_cohorts_completed_learners} {reopen?.impact.other_cohorts_completed_learners === 1 ? 'learner' : 'learners'}</p>}
        <p className="mt-3 text-sm text-ink-muted">Their saved work stays recorded, but their lesson and course completion percentages may go down.</p>
      </Modal>

      <Modal
        open={Boolean(watchReset)}
        onClose={() => setWatchReset(null)}
        size="md"
        title="Replace the video?"
        subtitle={watchReset?.message}
        footer={<>
          <Button variant="secondary" onClick={() => setWatchReset(null)}>Keep the old video</Button>
          <Button variant="danger" onClick={() => {
            const ids = watchReset?.ids || []
            setWatchReset(null)
            void save(ids)
          }}>Replace and reset watch time</Button>
        </>}
      />

      <Modal
        open={confirmDuplicate}
        onClose={() => setConfirmDuplicate(false)}
        size="md"
        title="Duplicate this lesson?"
        subtitle="The copy gets new blocks and no student work. It starts archived on the same day, so students don't see it until you restore it."
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDuplicate(false)}>Cancel</Button>
          <Button onClick={() => void duplicateLesson()}><Copy className="h-4 w-4" />Duplicate lesson</Button>
        </>}
      />

      {moveOpen && (
        <MoveLessonDialog
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          lesson={{ id: lessonId, title: lesson.title, module_id: context.module.id, release_day: draft.release_day, updated_at: updatedAtRef.current }}
          curriculumId={lesson.curriculum_id}
          onMoved={async (summary) => {
            toast.success(summary)
            // The dialog can't be dismissed while the move runs, so the draft
            // should still be the saved one. If it isn't, keep those edits and
            // let the person reload when ready instead of replacing them.
            if (draftRef.current && draftSignature(draftRef.current) !== savedSigRef.current) {
              setStatus('conflict')
              setSaveError('This lesson moved while you had unsaved changes. They are still here: copy anything you need, then reload to see the lesson in its new place.')
            } else {
              draftRef.current = null
              await load()
            }
            setMoveOpen(false)
          }}
        />
      )}

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        size="md"
        title="Archive this lesson?"
        subtitle="Students stop seeing it. Its content, progress and submissions are kept, and you can restore it."
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmArchive(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void archive(false)}>Archive lesson</Button>
        </>}
      />
    </div>
  )
}

/** Staff without editing access read the lesson as students see it (README §12, decision 1). */
function ReadOnlyLesson({ lesson, access, back, context, backup, onCopied }: { lesson: LessonDetail; access: LessonEditAccess; back: BackLink; context: LessonBlockEditorResponse['context']; backup: LocalDraftBackup | null; onCopied: (copy: CurriculumCopyResponse['curriculum_copy']) => Promise<void> | void }) {
  const blocks = [...lesson.content_blocks].sort((a, b) => a.position - b.position)
  const notice = readOnlyNotice(access)
  const toast = useToast()
  const now = useNow(60000)
  return (
    <div className="app-page max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link to={back.to} state={RESTORE_LIST_STATE} data-back-link="" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 font-semibold text-ink-muted hover:bg-surface-sunken hover:text-ink"><ChevronLeft className="h-4 w-4" />{back.label}</Link>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 truncate text-xs text-ink-muted sm:block">
          <Link to={curriculumPath(context.curriculum.id)} className="hover:text-ink hover:underline">{context.curriculum.name}</Link>
          <span aria-hidden="true"> › </span>
          <Link to={moduleRecordPath(context.module.id)} className="hover:text-ink hover:underline">{context.module.name}</Link>
          <span aria-hidden="true"> › </span>
          <Link to={lessonRecordPath(lesson.id)} className="hover:text-ink hover:underline">{lesson.title}</Link>
        </nav>
      </div>
      <h1 className="app-title">{lesson.title}</h1>
      <div role="status" className="flex gap-3 rounded-2xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <p><strong>{notice.title}.</strong> {notice.body}</p>
          {lesson.curriculum_id && <CopyForCohortAction curriculumId={lesson.curriculum_id} cohorts={access.copy_cohorts ?? []} onCopied={onCopied} />}
        </div>
      </div>
      {backup && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink sm:flex-row sm:items-center">
          <History className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
          <p className="min-w-0 flex-1">This browser kept changes you didn't save ({savedAgo(backup.savedAt, now)}). You can't save them without editing access, so they stay here until it's back. Copy them to keep a copy elsewhere.</p>
          <Button size="sm" variant="secondary" onClick={() => void copyText(localDraftText(backup)).then((copied) => copied ? toast.success('Unsaved changes copied') : toast.error('Couldn\'t copy the changes. Try again.'))}>
            <Copy className="h-4 w-4" />Copy unsaved changes
          </Button>
        </div>
      )}
      {lesson.archived_at && <p className="text-sm text-ink-muted">Archived lesson</p>}
      <LearningObjectivesPanel objectives={lesson.objectives || []} preview />
      {blocks.map((block) => <ContentBlockRenderer key={block.id} block={{ ...block, progress: undefined }} isStaff lessonReturn={{ url: window.location.href, label: lesson.title }} starterOpensNewTab />)}
    </div>
  )
}
