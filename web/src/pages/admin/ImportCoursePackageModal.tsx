import { useState } from 'react'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { api } from '../../lib/api'

type Preview = NonNullable<Awaited<ReturnType<typeof api.previewCoursePackage>>['data']>['preview']

export function ImportCoursePackageModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [packageData, setPackageData] = useState<unknown>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadFile = async (file: File | undefined) => {
    setPackageData(null)
    setPreview(null)
    setError('')
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('Choose a course package smaller than 2 MB.')
      return
    }
    setBusy(true)
    try {
      const data: unknown = JSON.parse(await file.text())
      const response = await api.previewCoursePackage(data)
      if (!response.data) throw new Error(response.error || 'Could not check this course package.')
      setPackageData(data)
      setPreview(response.data.preview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this course package.')
    } finally {
      setBusy(false)
    }
  }

  const importPackage = async () => {
    if (!preview || !packageData) return
    setBusy(true)
    setError('')
    try {
      const response = await api.importCoursePackage(packageData)
      if (!response.data) throw new Error(response.error || 'The package was not imported.')
      await onImported()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The package was not imported.')
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !preview} onClick={() => { void importPackage() }}>{preview?.unchanged ? 'Confirm existing course' : 'Import draft'}</Button>
    </div>
  )

  return (
    <Modal open title="Import course package" subtitle="Prepare lessons and exercises together, then attach recordings in the lesson editor." size="md" onClose={() => { if (!busy) onClose() }} footer={footer}>
      <div className="space-y-4">
        <p className="text-sm text-ink-secondary">Imported courses stay in draft and are not assigned to a cohort. Staff answers remain restricted to staff. Existing bootcamp and alumni courses are separate.</p>
        <div>
          <label htmlFor="course-package-file" className="mb-2 block text-sm font-medium text-ink-secondary">Course package file (.json)</label>
          <input id="course-package-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void loadFile(event.target.files?.[0]) }} className="app-control min-h-11 w-full" />
        </div>
        {busy && <p role="status" className="rounded-xl border border-info-200 bg-info-50 px-3 py-2 text-sm text-info-800">Working on the course package...</p>}
        {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
        {preview && (
          <div className="app-surface-muted p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold text-ink" title={preview.title}>{preview.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                {preview.unchanged
                  ? <Badge tone="neutral">Already imported</Badge>
                  : preview.existing_curriculum_id
                    ? <Badge tone="warning">Revises draft</Badge>
                    : <Badge tone="success">New draft</Badge>}
                <Badge tone={preview.status === 'active' ? 'success' : 'neutral'}>{preview.status.charAt(0).toUpperCase() + preview.status.slice(1)}</Badge>
                <Badge tone="neutral">{preview.assigned ? 'Assigned' : 'Unassigned'}</Badge>
              </div>
            </div>
            <ul className="mt-3 grid grid-cols-3 gap-2 text-sm text-ink-secondary">
              <li className="rounded-xl border border-line bg-surface-raised px-3 py-2"><span className="block text-lg font-semibold tabular-nums text-ink">{preview.modules}</span> modules</li>
              <li className="rounded-xl border border-line bg-surface-raised px-3 py-2"><span className="block text-lg font-semibold tabular-nums text-ink">{preview.lessons}</span> lessons</li>
              <li className="rounded-xl border border-line bg-surface-raised px-3 py-2"><span className="block text-lg font-semibold tabular-nums text-ink">{preview.blocks}</span> content blocks</li>
            </ul>
            <p className="mt-3 text-sm text-ink-secondary">{preview.unchanged ? `This exact package is already imported. Current status: ${preview.status}${preview.assigned ? ', assigned to a cohort' : ', unassigned'}.` : preview.existing_curriculum_id ? 'This revises the unassigned draft previously imported from this package.' : 'A new, unassigned draft will be created.'}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
