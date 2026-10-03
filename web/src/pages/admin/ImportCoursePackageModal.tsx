import { useState } from 'react'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
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

  return (
    <Modal open title="Import course package" subtitle="Prepare lessons and exercises together, then attach recordings in the lesson editor." size="md" onClose={() => { if (!busy) onClose() }}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Imported courses stay in draft and are not assigned to a cohort. Staff answers remain restricted to staff. Existing bootcamp and alumni courses are separate.</p>
        <div>
          <label htmlFor="course-package-file" className="mb-2 block text-sm font-medium text-slate-700">Course package file (.json)</label>
          <input id="course-package-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void loadFile(event.target.files?.[0]) }} className="app-control min-h-11" />
        </div>
        {busy && <p role="status" className="text-sm text-slate-600">Working on the course package...</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {preview && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-semibold text-slate-900">{preview.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{preview.modules} modules · {preview.lessons} lessons · {preview.blocks} content blocks</p>
            <p className="mt-2 text-sm text-slate-600">{preview.unchanged ? `This exact package is already imported. Current status: ${preview.status}${preview.assigned ? ', assigned to a cohort' : ', unassigned'}.` : preview.existing_curriculum_id ? 'This revises the unassigned draft previously imported from this package.' : 'A new, unassigned draft will be created.'}</p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={busy || !preview} onClick={() => { void importPackage() }}>{preview?.unchanged ? 'Confirm existing course' : 'Import draft'}</Button>
        </div>
      </div>
    </Modal>
  )
}
