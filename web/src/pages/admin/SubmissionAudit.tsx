import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listLinkState } from '../../lib/navigationContext'
import { cohortPath, lessonEditorPath } from '../../lib/routes'
import { api } from '../../lib/api'
import type { components } from '../../types/api.generated'
import { Button } from '../../components/ui/Button'

type Block = components['schemas']['SubmissionAuditBlock']
export function SubmissionAudit() {
  const location = useLocation()
  const returnState = listLinkState(location, 'Submission audit')
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const listVersion = useRef(0)
  const load = useCallback(async () => {
    const version = ++listVersion.current
    setError(null)
    const result = await api.getSubmissionAudit()
    if (version !== listVersion.current) return
    if (result.data) setBlocks(result.data.blocks)
    else setError(result.error || 'The audit could not be loaded.')
  }, [])
  useEffect(() => { void load() }, [load])
  async function review(block: Block) {
    setSaving(block.id)
    setError(null)
    try {
      const result = await api.reviewSubmissionAudit(block.id, block.content_digest)
      if (result.data) {
        ++listVersion.current
        setBlocks((rows) => rows?.filter((row) => row.id !== block.id) ?? null)
      }
      else setError(result.error || 'The review could not be saved.')
    } finally { setSaving(null) }
  }
  return <div className="app-page-wide space-y-6">
    <Link to="/admin/content" className="app-link inline-flex min-h-11 items-center">Back to Content</Link>
    <header><h1 className="text-2xl font-bold text-ink">Submission audit</h1><p className="mt-2 text-ink-muted">Blocks that may ask for work without a submission. Review each suggestion before changing what learners need to finish.</p></header>
    {error && <div role="alert" className="app-surface p-4"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Reload audit</Button></div>}
    {!blocks && !error && <p role="status">Loading audit…</p>}
    {blocks?.length === 0 && <section className="app-surface p-6"><h2 className="text-lg font-bold">No blocks need review</h2><p>Reviewed practice stays dismissed unless its content or submission settings change.</p></section>}
    {blocks && blocks.length > 0 && <p className="text-ink-muted">{blocks.length} blocks to review</p>}
    {blocks?.map((block) => {
      const params = new URLSearchParams({ block: String(block.id), return_to: '/admin/content/submission-audit' })
      const editor = `${lessonEditorPath(block.lesson_id)}?${params}`
      const actionParams = new URLSearchParams(params)
      if (block.suggested_type) actionParams.set('suggest_submission', block.suggested_type)
      else actionParams.set('add_companion', '1')
      const action = `${lessonEditorPath(block.lesson_id)}?${actionParams}`
      return <article key={block.id} className="app-surface space-y-3 p-4 sm:p-6">
        <p className="break-words text-sm text-ink-muted"><Link className="app-link" to={`/admin/content?curriculum=${block.curriculum_id}`}>{block.curriculum_name}</Link> › <Link className="app-link" to={`/admin/content?curriculum=${block.curriculum_id}&open=${block.module_id}`}>{block.module_name}</Link> › <Link className="app-link" to={editor} state={returnState}>{block.lesson_title}</Link></p>
        <h2 className="text-lg font-semibold text-ink"><Link className="app-link" to={editor} state={returnState}>{block.title || 'Untitled block'}</Link></h2>
        <p className="whitespace-pre-wrap break-words text-sm text-ink-muted">{block.body}</p>
        <p className="text-sm text-ink">{block.completed_learners} {block.completed_learners === 1 ? 'learner' : 'learners'} completed this block</p>
        {!block.suggested_type && block.completion_impact.completed_learners > 0 && <p className="rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-ink">{block.completion_impact.completed_learners} {block.completion_impact.completed_learners === 1 ? 'learner' : 'learners'} finished this lesson. Adding an exercise reopens it for them until they submit.</p>}
        {block.suggested_type && <p className="text-sm text-ink-muted">Changing this existing work block keeps recorded completions.</p>}
        {block.cohort_submissions.length > 0 && <ul className="space-y-1 text-sm text-ink-muted" aria-label="Submission behavior by cohort">{block.cohort_submissions.map((cohort) => <li key={cohort.id}><Link className="app-link" to={cohortPath(cohort.id)}>{cohort.name}</Link>: {cohort.submission_type === 'manual_complete' ? 'No submission' : cohort.submission_type === 'prework_github_sync' ? 'GitHub sync' : 'Submission configured'}</li>)}</ul>}
        <div className="flex flex-wrap items-center gap-3"><Link className="app-link inline-flex min-h-11 items-center rounded-xl px-3" to={action} state={returnState}>{block.suggested_type ? 'Needs a submission' : 'Add a companion exercise'}</Link><Button variant="secondary" disabled={saving !== null} onClick={() => void review(block)}>{saving === block.id ? 'Saving review…' : 'Practice only — mark as reviewed'}</Button></div>
      </article>
    })}
  </div>
}
