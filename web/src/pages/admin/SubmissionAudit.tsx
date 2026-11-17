import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listLinkState } from '../../lib/navigationContext'
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
  const load = useCallback(async () => {
    setError(null)
    const result = await api.getSubmissionAudit()
    if (result.data) setBlocks(result.data.blocks)
    else setError(result.error || 'The audit could not be loaded.')
  }, [])
  useEffect(() => { void load() }, [load])
  async function review(block: Block) {
    setSaving(block.id)
    setError(null)
    try {
      const result = await api.reviewSubmissionAudit(block.id, block.content_digest)
      if (result.data) setBlocks((rows) => rows?.filter((row) => row.id !== block.id) ?? null)
      else setError(result.error || 'The review could not be saved.')
    } finally { setSaving(null) }
  }
  return <div className="app-page-wide space-y-6">
    <Link to="/admin/content" className="app-link inline-flex min-h-11 items-center">Back to Content</Link>
    <header><h1 className="text-2xl font-bold text-ink">Submission audit</h1><p className="mt-2 text-ink-muted">Blocks that may ask for work without a submission. Review each suggestion. Learner progress stays saved.</p></header>
    {error && <div role="alert" className="app-surface p-4"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Reload audit</Button></div>}
    {!blocks && !error && <p role="status">Loading audit…</p>}
    {blocks?.length === 0 && <section className="app-surface p-6"><h2 className="text-lg font-bold">No blocks need review</h2><p>Reviewed practice stays dismissed unless its text changes.</p></section>}
    {blocks && blocks.length > 0 && <p className="text-ink-muted">{blocks.length} blocks to review</p>}
    {blocks?.map((block) => {
      const editor = `/admin/lessons/${block.lesson_id}/edit?block=${block.id}&return_to=${encodeURIComponent('/admin/content/submission-audit')}`
      return <article key={block.id} className="app-surface space-y-3 p-4 sm:p-6">
        <p className="break-words text-sm text-ink-muted"><Link className="app-link" to={`/admin/content?curriculum=${block.curriculum_id}`}>{block.curriculum_name}</Link> › <Link className="app-link" to={`/admin/content?curriculum=${block.curriculum_id}&open=${block.module_id}`}>{block.module_name}</Link> › <Link className="app-link" to={editor} state={returnState}>{block.lesson_title}</Link></p>
        <h2 className="text-lg font-semibold text-ink"><Link className="app-link" to={editor} state={returnState}>{block.title || 'Untitled block'}</Link></h2>
        <p className="whitespace-pre-wrap break-words text-sm text-ink-muted">{block.body}</p>
        <p className="text-sm text-ink">{block.completed_learners} {block.completed_learners === 1 ? 'learner' : 'learners'} completed this block</p>
        <div className="flex flex-wrap items-center gap-3"><Link className="app-link inline-flex min-h-11 items-center rounded-xl px-3" to={`${editor}&suggest_submission=${block.suggested_type}`} state={returnState}>Needs a submission</Link><Button variant="secondary" disabled={saving !== null} onClick={() => void review(block)}>{saving === block.id ? 'Saving review…' : 'Practice only — mark as reviewed'}</Button></div>
      </article>
    })}
  </div>
}
