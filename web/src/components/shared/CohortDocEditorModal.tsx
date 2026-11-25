import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowLeft, BookOpen, Copy, Download, History, Loader2, MessageSquare, Pencil, Printer, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useConfirm } from '../../contexts/ConfirmContext'
import { api } from '../../lib/api'
import {
  DOC_AUTOSAVE_MS,
  MAX_DOC_LENGTH,
  downloadMarkdown,
  isStudentFolderItem,
  toggleTaskAt,
  type CohortDoc,
  type CohortDocRevision,
  type CohortDocRevisionDetail,
  type CohortFile,
} from '../../lib/cohortFiles'
import { formatShortDateTime } from '../../lib/format'
import { Button } from '../ui/Button'
import { OverflowMenu } from '../ui/OverflowMenu'
import { CohortFileReviewPanel, type ReviewAccess } from './CohortFileReview'
import { LazyMarkdownEditor } from './LazyMarkdownEditor'
import { MarkdownRenderer } from './MarkdownRenderer'
import { Modal } from './Modal'

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error'
type Side = 'history' | 'review'
type Pane = 'doc' | Side

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  conflict: 'Not saved: someone else updated this doc',
  error: 'Not saved',
}

function DocMarkdown({ content, onToggleTask }: { content: string; onToggleTask?: (itemStart: number) => void }) {
  return content.trim()
    ? <MarkdownRenderer content={content} variant="doc" onToggleTask={onToggleTask} />
    : <p className="text-sm text-ink-muted">This doc is empty.</p>
}

/**
 * A Learn Doc: Markdown written in the app. Read shows it as students see it
 * (task boxes can be ticked by anyone who can edit); Edit uses the shared
 * editor and saves itself after a pause in typing. A save made from an older
 * copy than the server's is refused (409) and nothing is lost: the banner
 * offers the latest version and a copy of the unsaved text. History lists
 * saved states and restores one. Items in a student's folder show their
 * review status and comments beside the doc (a tab on phones).
 */
export function CohortDocEditorModal({ cohortId, file, open, onClose, onFileChange, reviewAccess, initialPane = 'doc' }: {
  cohortId: number
  file: CohortFile
  open: boolean
  onClose: () => void
  onFileChange: (file: CohortFile) => void
  /** Set for items in a student's folder: who may change the review status. */
  reviewAccess?: ReviewAccess
  initialPane?: Pane
}) {
  const id = useId()
  const confirm = useConfirm()
  const showReview = Boolean(reviewAccess) && isStudentFolderItem(file)
  const [doc, setDoc] = useState<CohortDoc | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [title, setTitle] = useState(file.title)
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [saveError, setSaveError] = useState('')
  const [side, setSide] = useState<Side>(initialPane === 'history' || !showReview ? 'history' : 'review')
  const [pane, setPane] = useState<Pane>(initialPane === 'review' && !showReview ? 'doc' : initialPane)
  const [printing, setPrinting] = useState(false)
  const [copied, setCopied] = useState(false)
  // What the server has, the edit it was based on, and saves in flight.
  const saved = useRef({ title: file.title, content: '' })
  const base = useRef<string | null>(null)
  const draft = useRef({ title: file.title, content: '' })
  const inFlight = useRef(false)
  const queued = useRef<'plain' | 'checkpoint' | null>(null)
  const conflict = useRef(false)
  const canEdit = Boolean(doc?.can_edit_doc)
  // A cleared title keeps the saved one.
  const changedFrom = (next: { title: string; content: string }) => (next.title.trim() || saved.current.title) !== saved.current.title || next.content !== saved.current.content
  const dirty = changedFrom({ title, content })
  draft.current = { title, content }

  const apply = useCallback((next: CohortDoc) => {
    setDoc(next)
    saved.current = { title: next.file.title, content: next.doc_content }
    base.current = next.doc_updated_at
  }, [])

  useEffect(() => {
    if (!open) return
    let live = true
    setLoadError('')
    void api.getCohortDoc(cohortId, file.id).then((result) => {
      if (!live) return
      if (!result.data) return setLoadError(result.error || 'Could not open this doc.')
      apply(result.data)
      setTitle(result.data.file.title)
      setContent(result.data.doc_content)
      setMode(result.data.can_edit_doc && !result.data.doc_content.trim() ? 'edit' : 'read')
      setStatus('saved')
    })
    return () => { live = false }
  }, [apply, attempt, cohortId, file.id, open])

  const save = useCallback(async (checkpoint = false) => {
    if (!doc?.can_edit_doc || conflict.current) return
    if (inFlight.current) {
      queued.current = checkpoint || queued.current === 'checkpoint' ? 'checkpoint' : 'plain'
      return
    }
    const sending = { ...draft.current }
    if (!checkpoint && !changedFrom(sending)) return setStatus('saved')
    if (sending.content.length > MAX_DOC_LENGTH) {
      setStatus('error')
      return setSaveError(`Docs can be up to ${MAX_DOC_LENGTH.toLocaleString()} characters.`)
    }
    inFlight.current = true
    setStatus('saving')
    setSaveError('')
    const result = await api.saveCohortDoc(cohortId, file.id, {
      doc_content: sending.content,
      ...(sending.title.trim() ? { title: sending.title.trim() } : {}),
      ...(base.current ? { base_updated_at: base.current } : {}),
      ...(checkpoint ? { save_revision: true } : {}),
    })
    inFlight.current = false
    if (result.data) {
      apply(result.data)
      onFileChange(result.data.file)
      setStatus(changedFrom(draft.current) ? 'unsaved' : 'saved')
      // A save asked for while this one was in flight runs now; later typing has its own timer.
      const next = queued.current
      queued.current = null
      if (next) void save(next === 'checkpoint')
    } else if (result.status === 409) {
      conflict.current = true
      queued.current = null
      setStatus('conflict')
    } else {
      queued.current = null
      setStatus('error')
      setSaveError(result.error || 'Could not save this doc.')
    }
  }, [apply, cohortId, doc?.can_edit_doc, file.id, onFileChange])

  // Save a moment after typing stops.
  useEffect(() => {
    if (!canEdit || !dirty || conflict.current) return
    setStatus((current) => (current === 'saving' ? current : 'unsaved'))
    const timer = window.setTimeout(() => void save(), DOC_AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [canEdit, content, dirty, save, title])

  // Warn before leaving the page with changes that haven't saved.
  useEffect(() => {
    if (!open || !dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, open])

  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    const frame = window.requestAnimationFrame(() => {
      window.print()
      // Browsers that print synchronously have already finished.
      window.setTimeout(done, 0)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const loadLatest = async () => {
    const result = await api.getCohortDoc(cohortId, file.id)
    if (!result.data) return setSaveError(result.error || 'Could not load the latest version.')
    conflict.current = false
    apply(result.data)
    onFileChange(result.data.file)
    setTitle(result.data.file.title)
    setContent(result.data.doc_content)
    setStatus('saved')
    setSaveError('')
  }
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft.current.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setSaveError('Copying is blocked in this browser. Select the text in Edit and copy it.')
    }
  }
  const close = async () => {
    if (dirty && canEdit && (status === 'conflict' || status === 'error')) {
      const ok = await confirm({ title: 'Close without saving?', description: 'Your latest changes have not been saved.', confirmLabel: 'Close without saving', tone: 'danger' })
      if (!ok) return
    } else if (dirty && canEdit) {
      void save()
    }
    onClose()
  }
  const toggleTask = (itemStart: number) => {
    if (!canEdit || status === 'conflict') return
    setContent((current) => toggleTaskAt(current, itemStart))
  }
  const restored = (next: CohortDoc) => {
    conflict.current = false
    apply(next)
    onFileChange(next.file)
    setTitle(next.file.title)
    setContent(next.doc_content)
    setStatus('saved')
    setPane('doc')
    setMode('read')
  }
  const choosePane = (next: Pane) => {
    setPane(next)
    if (next !== 'doc') setSide(next)
  }

  const statusText = !doc ? undefined : canEdit ? STATUS_TEXT[status] : 'Read only'
  const sideTabs: Array<[Side, string, typeof History]> = [...(showReview ? [['review', 'Review', MessageSquare] as [Side, string, typeof History]] : []), ['history', 'History', History]]

  return (
    <Modal open={open} onClose={() => void close()} title={title.trim() || file.title} subtitle={statusText ? `Learn Doc · ${statusText}` : 'Learn Doc'} size="xl" fixedHeight
      footer={doc && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-h-6 text-sm text-ink-secondary" aria-live="polite">
            {canEdit
              ? <>{STATUS_TEXT[status]}{saveError ? <span className="text-danger-ink"> · {saveError}</span> : null}</>
              : `Last saved ${formatShortDateTime(doc.doc_updated_at, '')}${doc.doc_updated_by_name ? ` by ${doc.doc_updated_by_name}` : ''}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <OverflowMenu label="Export this doc" items={[
              { key: 'md', label: 'Download .md', icon: <Download className="h-4 w-4" aria-hidden="true" />, onSelect: () => downloadMarkdown(title.trim() || file.title, content) },
              { key: 'print', label: 'Print or save as PDF', icon: <Printer className="h-4 w-4" aria-hidden="true" />, onSelect: () => setPrinting(true) },
            ]} />
            {canEdit && (
              <Button disabled={status === 'saving' || status === 'conflict'} onClick={() => void save(true)}>
                {status === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save
              </Button>
            )}
          </div>
        </div>
      )}>
      {loadError ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-ink-secondary">{loadError}</p>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : !doc ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-secondary" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Opening {file.title}…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {status === 'conflict' && (
            <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Someone else updated this doc. Load the latest version; copy your text first if you want to keep it.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copyDraft()}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy my text'}
                </Button>
                <Button size="sm" onClick={() => void loadLatest()}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Load latest
                </Button>
              </div>
            </div>
          )}
          <div role="tablist" aria-label="Doc sections" className="inline-flex w-full rounded-xl border border-line bg-surface-sunken p-1 lg:hidden">
            {([['doc', 'Doc'], ...sideTabs.map(([value, label]) => [value, label])] as Array<[Pane, string]>).map(([value, label]) => (
              <button key={value} type="button" role="tab" id={`${id}-tab-${value}`} aria-selected={pane === value} aria-controls={value === 'doc' ? `${id}-doc` : `${id}-side`}
                onClick={() => choosePane(value)}
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${pane === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 gap-5">
            <section id={`${id}-doc`} aria-label="Doc" className={`min-h-0 min-w-0 flex-1 flex-col overflow-y-auto ${pane === 'doc' ? 'flex' : 'hidden lg:flex'}`}>
              {canEdit && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div role="group" aria-label="View" className="inline-flex rounded-xl border border-line bg-surface-sunken p-1">
                    {([['read', 'Read', BookOpen], ['edit', 'Edit', Pencil]] as const).map(([value, label, Icon]) => (
                      <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 lg:min-h-9 ${mode === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-muted">Saves on its own as you type.</p>
                </div>
              )}
              {canEdit && mode === 'edit' ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-ink">
                    Title
                    <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={status === 'conflict'} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <div>
                    <span id={`${id}-content-label`} className="block text-sm font-medium text-ink">Content</span>
                    <LazyMarkdownEditor label="Doc content" target="lesson" variant="field" value={content} onChange={(value) => setContent(value)}
                      disabled={status === 'conflict'} minHeight={320} className="mt-1" describedBy={`${id}-content-label`}
                      renderPreview={(markdown) => <DocMarkdown content={markdown} />} />
                    <p className={`mt-1 text-right text-xs tabular-nums ${content.length > MAX_DOC_LENGTH ? 'font-semibold text-danger-ink' : 'text-ink-muted'}`}>
                      {content.length.toLocaleString()}/{MAX_DOC_LENGTH.toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <article className="min-w-0">
                  <DocMarkdown content={content} onToggleTask={canEdit && status !== 'conflict' ? toggleTask : undefined} />
                </article>
              )}
            </section>
            <aside id={`${id}-side`} aria-label={side === 'review' ? 'Review and comments' : 'History'}
              className={`min-h-0 w-full flex-col overflow-y-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-line lg:pl-5 ${pane === 'doc' ? 'hidden lg:flex' : 'flex'}`}>
              {sideTabs.length > 1 && (
                <div role="group" aria-label="Side panel" className="mb-3 hidden rounded-xl border border-line bg-surface-sunken p-1 lg:inline-flex">
                  {sideTabs.map(([value, label, Icon]) => (
                    <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}
                      className={`inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${side === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {side === 'review' && showReview && reviewAccess ? (
                <CohortFileReviewPanel cohortId={cohortId} file={doc.file} access={reviewAccess}
                  onFileChange={(next) => { setDoc((current) => current && { ...current, file: next }); onFileChange(next) }} />
              ) : (
                <DocHistory cohortId={cohortId} file={file} canRestore={canEdit} revisionCount={doc.revision_count}
                  baseUpdatedAt={() => base.current} dirty={dirty} onRestored={restored} onConflict={() => { conflict.current = true; setStatus('conflict') }} />
              )}
            </aside>
          </div>
        </div>
      )}
      {printing && createPortal(
        <div className="doc-print-root">
          <h1 className="doc-print-title">{title.trim() || file.title}</h1>
          <MarkdownRenderer content={content} variant="doc" />
        </div>,
        document.body,
      )}
    </Modal>
  )
}

/** Saved states of the doc, newest first: inspect one, then restore it. */
function DocHistory({ cohortId, file, canRestore, revisionCount, baseUpdatedAt, dirty, onRestored, onConflict }: {
  cohortId: number
  file: CohortFile
  canRestore: boolean
  revisionCount: number
  baseUpdatedAt: () => string | null
  dirty: boolean
  onRestored: (doc: CohortDoc) => void
  onConflict: () => void
}) {
  const confirm = useConfirm()
  const [revisions, setRevisions] = useState<CohortDocRevision[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<CohortDocRevisionDetail | null>(null)
  const [opening, setOpening] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let live = true
    setError('')
    void api.getCohortDocRevisions(cohortId, file.id).then((result) => {
      if (!live) return
      if (result.data) setRevisions(result.data.revisions)
      else setError(result.error || 'Could not load history.')
    })
    return () => { live = false }
  }, [attempt, cohortId, file.id, revisionCount])

  const inspect = async (revision: CohortDocRevision) => {
    setOpening(revision.id)
    const result = await api.getCohortDocRevision(cohortId, file.id, revision.id)
    setOpening(null)
    if (!result.data) return setError(result.error || 'Could not open this revision.')
    setSelected(result.data.revision)
  }
  const restore = async (revision: CohortDocRevisionDetail) => {
    const ok = await confirm({
      title: `Restore revision ${revision.revision_number}?`,
      description: `The doc goes back to this version${dirty ? ', and your unsaved changes are replaced' : ''}. The current version stays in History.`,
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setRestoring(true)
    const result = await api.restoreCohortDocRevision(cohortId, file.id, revision.id, baseUpdatedAt())
    setRestoring(false)
    if (result.data) {
      setSelected(null)
      return onRestored(result.data)
    }
    if (result.status === 409) return onConflict()
    setError(result.error || 'Could not restore this revision.')
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <Button size="sm" variant="quiet" onClick={() => setSelected(null)}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All revisions
        </Button>
        <div>
          <p className="text-sm font-semibold text-ink">{`Revision ${selected.revision_number}${selected.summary ? ` · ${selected.summary}` : ''}`}</p>
          <p className="text-xs text-ink-muted">{`${formatShortDateTime(selected.created_at, '')}${selected.edited_by_name ? ` · ${selected.edited_by_name}` : ''}`}</p>
        </div>
        {canRestore && (
          <Button size="sm" disabled={restoring} onClick={() => void restore(selected)}>
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Restore this version
          </Button>
        )}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <div className="rounded-xl border border-line bg-surface-sunken p-3">
          <p className="mb-2 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{selected.title}</p>
          <DocMarkdown content={selected.content} />
        </div>
      </div>
    )
  }
  return (
    <section className="space-y-3" aria-label="Revision history">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4 text-ink-muted" aria-hidden="true" />History</h3>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-ink">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}
      {revisions === null ? (
        !error && <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading history…</p>
      ) : revisions.length === 0 ? (
        <p className="text-sm text-ink-muted">No earlier versions yet. History starts with the first edit.</p>
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button type="button" onClick={() => void inspect(revision)} disabled={opening !== null}
                className="flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-sunken">
                <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-ink-muted">{`#${revision.revision_number}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{revision.summary || revision.title}</span>
                  <span className="block text-xs text-ink-muted">{`${formatShortDateTime(revision.created_at, '')}${revision.edited_by_name ? ` · ${revision.edited_by_name}` : ''}`}</span>
                </span>
                {opening === revision.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-muted" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
