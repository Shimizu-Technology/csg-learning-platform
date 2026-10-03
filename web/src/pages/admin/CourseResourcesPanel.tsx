import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../../lib/api'
import { uploadToS3 } from '../../lib/uploadToS3'
import type { ResourceEntry } from '../../types/api'
import { downloadCourseResource } from '../../lib/downloadCourseResource'

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

  return <section className="border-t border-slate-200 px-6 py-4" aria-label="Course learner files" data-curriculum-id={curriculumId}>
    <h3 className="font-semibold text-slate-900">Learner ZIP files</h3>
    <p className="mt-1 text-sm text-slate-600">Upload the matching course bundle. This adds files without opening admissions or changing enrollment.</p>
    {resources.length > 0 && <ul className="mt-3 space-y-3 text-sm text-slate-700">{resources.map(r => <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 break-words">{r.title} — {r.filename}{r.ready === false && <p className="mt-1 text-slate-500">Upload not confirmed</p>}</div><button type="button" disabled={busy || fileActionId !== null || !r.download_id} onClick={() => void fileAction(r)} className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{fileActionId === r.download_id ? 'Working…' : r.ready === false ? 'Abandon pending upload' : 'Download ZIP'}</button></li>)}</ul>}
    {draft && authorized && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm font-medium text-slate-700">File title<input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={160} className="app-control mt-1 w-full" /></label>
      <label className="flex-1 text-sm font-medium text-slate-700">Course ZIP<input type="file" accept=".zip,application/zip" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1 block min-h-11 w-full text-sm" /></label>
      <button type="button" disabled={busy || fileActionId !== null || !file || !title.trim()} onClick={() => void upload()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Upload className="h-4 w-4" />{busy ? `Uploading ${progress}%` : 'Upload ZIP'}</button>
    </div>}
    {!draft && <p className="mt-2 text-sm text-slate-500">New files can be added while the curriculum is a draft.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-2 text-sm text-green-700">{message}</p>}
  </section>
}
