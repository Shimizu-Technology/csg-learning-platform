import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../../lib/api'
import { uploadToS3 } from '../../lib/uploadToS3'
import type { ResourceEntry } from '../../types/api'
import { downloadCourseResource } from '../../lib/downloadCourseResource'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

export function CourseResourcesPanel({ curriculumId, draft }: { curriculumId: number; draft: boolean }) {
  const [resources, setResources] = useState<ResourceEntry[]>([])
  const [title, setTitle] = useState('Learner resources')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [fileActionId, setFileActionId] = useState<number | null>(null)

  useEffect(() => {
    let ignore = false
    api.getCurriculumResources(curriculumId).then(res => {
      if (ignore) return
      if (res.data) { setResources(res.data.resources); setAuthorized(true) }
      else setError(res.error || 'Could not load course files.')
    }).catch(() => { if (!ignore) setError('Could not load course files.') })
    return () => { ignore = true }
  }, [curriculumId])

  const upload = async () => {
    if (!file || busy) return
    setError(''); setMessage(''); setBusy(true); setProgress(0)
    let pendingId: number | undefined
    try {
      if (!file.name.toLowerCase().endsWith('.zip') || file.size === 0 || file.size > 50 * 1024 * 1024) {
        throw new Error('Choose a nonempty ZIP no larger than 50 MB.')
      }
      const prepared = await api.createCurriculumResource(curriculumId, { title: title.trim(), filename: file.name, file_size: file.size })
      if (!prepared.data) throw new Error(prepared.error || 'Could not prepare the upload.')
      pendingId = prepared.data.resource.download_id
      await uploadToS3(prepared.data.upload_url, prepared.data.fields, new File([file], file.name, { type: 'application/zip' }), p => setProgress(p.percent))
      const completed = await api.completeCurriculumResource(curriculumId, prepared.data.resource.download_id)
      if (!completed.data) throw new Error(completed.error || 'Could not confirm the uploaded ZIP.')
      pendingId = undefined
      const refreshed = await api.getCurriculumResources(curriculumId)
      if (refreshed.data) setResources(refreshed.data.resources)
      setMessage('ZIP uploaded. Current course enrollment is required to download it.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.')
      if (pendingId) {
        const cleanup = await api.abandonCurriculumResource(curriculumId, pendingId).catch(() => null)
        if (!cleanup || (cleanup.error && cleanup.status !== 422)) setError(previous => `${previous} Pending upload cleanup failed; ask staff to retry cleanup.`)
      }
    } finally { setBusy(false) }
  }

  const fileAction = async (resource: ResourceEntry) => {
    if (!resource.download_id || fileActionId !== null || busy) return
    setFileActionId(resource.download_id); setError(''); setMessage('')
    try {
      if (resource.ready === false) {
        const abandoned = await api.abandonCurriculumResource(curriculumId, resource.download_id)
        if (abandoned.error) throw new Error(abandoned.error)
        setResources(current => current.filter(item => item.id !== resource.id))
        setMessage('Pending upload removed.')
      } else {
        await downloadCourseResource(curriculumId, resource.download_id, resource.filename || 'course-resources.zip')
        setMessage('Download started.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the file action.') }
    finally { setFileActionId(null) }
  }

  return <section className="border-t border-line px-4 py-4 sm:px-6" aria-label="Course learner files" data-curriculum-id={curriculumId}>
    <h3 className="text-base font-semibold text-ink">Learner ZIP files</h3>
    <p className="mt-1 text-sm text-ink-secondary">Upload the matching course bundle. This adds files without opening admissions or changing enrollment.</p>
    {resources.length > 0 && <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm text-ink-secondary">{resources.map(r => <li key={r.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 break-words"><span className="font-semibold text-ink">{r.title}</span> — {r.filename}{r.ready === false && <p className="mt-1"><Badge tone="warning">Upload not confirmed</Badge></p>}</div><Button variant={r.ready === false ? 'danger' : 'secondary'} size="sm" className="shrink-0" disabled={busy || fileActionId !== null || !r.download_id} onClick={() => void fileAction(r)}>{fileActionId === r.download_id ? 'Working…' : r.ready === false ? 'Abandon pending upload' : 'Download ZIP'}</Button></li>)}</ul>}
    {draft && authorized && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm font-medium text-ink-secondary">File title<input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={160} className="app-control mt-1 w-full" /></label>
      <label className="flex-1 text-sm font-medium text-ink-secondary">Course ZIP<input type="file" accept=".zip,application/zip" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1 block min-h-11 w-full text-sm" /></label>
      <Button variant="secondary" className="shrink-0 tabular-nums" disabled={busy || fileActionId !== null || !file || !title.trim()} onClick={() => void upload()}><Upload className="h-4 w-4" />{busy ? `Uploading ${progress}%` : 'Upload ZIP'}</Button>
    </div>}
    {!draft && <p className="mt-2 text-sm text-ink-muted">New files can be added while the curriculum is a draft.</p>}
    {error && <p role="alert" className="mt-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
    {message && <p role="status" className="mt-2 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700">{message}</p>}
  </section>
}
