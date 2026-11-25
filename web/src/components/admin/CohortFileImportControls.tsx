import { useEffect, useId, useState } from 'react'
import { BookCopy, Copy, Loader2, RefreshCw } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import type { AccessibleCohort } from '../../types/api'
import { Modal } from '../shared/Modal'
import { Button } from '../ui/Button'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * "Imported 2 items, 1 already here, copied to 3 student folders." Uploads
 * storage couldn't copy are named separately, with a retry, never counted as
 * already here.
 */
export function importSummary(verb: 'Imported' | 'Copied', added: number, skipped: number, autoCopied: number, failed = 0) {
  const parts = [`${verb} ${plural(added, 'item')}`]
  if (skipped) parts.push(`${skipped} already here`)
  if (autoCopied) parts.push(`copied to ${plural(autoCopied, 'student folder')}`)
  const summary = `${parts.join(', ')}.`
  return failed ? `${summary} ${plural(failed, 'upload')} couldn't be copied because file storage isn't available. Try again later.` : summary
}

/** The toast for an import or copy: an error when anything failed. */
function reportImport(toast: ReturnType<typeof useToast>, verb: 'Imported' | 'Copied', nothingNew: string,
  counts: { added: number; skipped: number; failed: number; autoCopied: number }) {
  const { added, skipped, failed, autoCopied } = counts
  if (failed) return toast.error(importSummary(verb, added, skipped, autoCopied, failed))
  toast.success(added === 0 && !autoCopied ? nothingNew : importSummary(verb, added, skipped, autoCopied))
}

/**
 * Brings class files into a cohort: the curriculum's template files (any
 * added since the cohort was created), or another cohort's class files.
 * Both are safe to repeat; items already here are skipped.
 */
export function CohortFileImportControls({ cohortId, onImported }: { cohortId: number; onImported: () => void }) {
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [picking, setPicking] = useState(false)
  const importCurriculum = async () => {
    if (importing) return
    setImporting(true)
    const result = await api.importCohortCurriculumFiles(cohortId)
    setImporting(false)
    if (!result.data) return toast.error(result.error || 'Could not import the curriculum files.')
    const { imported_count: added, skipped_count: skipped, failed_count: failed, auto_copied_count: autoCopied } = result.data
    reportImport(toast, 'Imported', 'Everything from the curriculum is already here.', { added, skipped, failed, autoCopied })
    onImported()
  }
  return (
    <>
      <Button size="sm" variant="secondary" disabled={importing} aria-busy={importing || undefined} onClick={() => void importCurriculum()}>
        {importing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BookCopy className="h-4 w-4" aria-hidden="true" />}
        {importing ? 'Importing…' : 'Import from curriculum'}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copy from another cohort
      </Button>
      {picking && <CopyFromCohortDialog cohortId={cohortId} onClose={() => setPicking(false)} onCopied={() => { setPicking(false); onImported() }} />}
    </>
  )
}

/** Choose another cohort this staff member can see and copy its class files here. */
function CopyFromCohortDialog({ cohortId, onClose, onCopied }: { cohortId: number; onClose: () => void; onCopied: () => void }) {
  const toast = useToast()
  const name = useId()
  const [cohorts, setCohorts] = useState<AccessibleCohort[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let ignore = false
    void api.getAccessibleCohorts().then((result) => {
      if (ignore) return
      if (result.data) {
        setCohorts(result.data.cohorts.filter((cohort) => cohort.id !== cohortId))
        setLoadError('')
      } else {
        setLoadError(result.error || 'Could not load your cohorts.')
      }
    })
    return () => { ignore = true }
  }, [cohortId, attempt])
  const copy = async () => {
    if (!sourceId || copying) return
    setCopying(true)
    setError('')
    const result = await api.copyCohortFilesFromCohort(cohortId, sourceId)
    setCopying(false)
    if (!result.data) return setError(result.error || 'Could not copy these files.')
    const { copied_count: added, skipped_count: skipped, failed_count: failed, auto_copied_count: autoCopied } = result.data
    reportImport(toast, 'Copied', 'This cohort already has those class files.', { added, skipped, failed, autoCopied })
    onCopied()
  }
  return (
    <Modal open onClose={onClose} title="Copy from another cohort" subtitle="Class files, links and docs are copied. Student folders never are." size="md"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" disabled={copying} onClick={onClose}>Cancel</Button>
          <Button disabled={!sourceId || copying} aria-busy={copying || undefined} onClick={() => void copy()}>
            {copying ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copying ? 'Copying…' : 'Copy class files'}
          </Button>
        </div>
      }>
      {loadError ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-danger-ink">{loadError}</p>
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : !cohorts ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading cohorts…
        </p>
      ) : cohorts.length === 0 ? (
        <p className="text-sm text-ink-secondary">There are no other cohorts you can copy from.</p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Copy class files from</legend>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {cohorts.map((cohort) => (
              <label key={cohort.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${sourceId === cohort.id ? 'border-focus bg-surface-sunken' : 'border-line'}`}>
                <input type="radio" name={name} className="mt-1" checked={sourceId === cohort.id} disabled={copying} onChange={() => setSourceId(cohort.id)} />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink [overflow-wrap:anywhere]">{cohort.name}</span>
                  {cohort.curriculum_name && <span className="block text-ink-secondary [overflow-wrap:anywhere]">{cohort.curriculum_name}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
    </Modal>
  )
}
