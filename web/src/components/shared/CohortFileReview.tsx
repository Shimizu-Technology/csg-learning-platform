import { useEffect, useId, useRef, useState } from 'react'
import { BadgeCheck, Check, CircleDot, Loader2, MessageSquare, RefreshCw, Send, Trash2, Undo2 } from 'lucide-react'
import { useConfirm } from '../../contexts/ConfirmContext'
import { api } from '../../lib/api'
import { MAX_COMMENT_LENGTH, type CohortFile, type CohortFileComment, type ReviewStatus } from '../../lib/cohortFiles'
import { formatShortDateTime } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Modal } from './Modal'

export interface ReviewAccess {
  /** Staff mark items reviewed; students only send their own for review. */
  staff: boolean
  /** The viewer can change the status and comment now (false for paused or ended learners). */
  canChange: boolean
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'needs_review') return <Badge tone="warning" icon={<CircleDot className="h-3 w-3" aria-hidden="true" />}>Needs review</Badge>
  if (status === 'reviewed') return <Badge tone="success" icon={<BadgeCheck className="h-3 w-3" aria-hidden="true" />}>Reviewed</Badge>
  return null
}

/** Opens an item's review thread from its row; shows the comment count. */
export function CommentCountChip({ count, title, onClick }: { count: number; title: string; onClick: () => void }) {
  const label = count === 0 ? 'Comment' : `${count} comment${count === 1 ? '' : 's'}`
  return (
    <Button size="sm" variant="quiet" onClick={onClick} aria-label={`${label} on ${title}`}>
      <MessageSquare className="h-4 w-4" aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
    </Button>
  )
}

/**
 * Review status for a student-folder item. An active student marks their own
 * item Ready for review (or takes it back); staff mark it Reviewed or Needs review.
 */
export function CohortFileReviewBar({ cohortId, file, access, onFileChange }: {
  cohortId: number
  file: CohortFile
  access: ReviewAccess
  onFileChange: (file: CohortFile) => void
}) {
  const [saving, setSaving] = useState<ReviewStatus | null>(null)
  const [error, setError] = useState('')
  const status = file.review_status
  const change = async (next: ReviewStatus) => {
    if (saving) return
    setSaving(next)
    setError('')
    const result = await api.setCohortFileReview(cohortId, file.id, next)
    setSaving(null)
    if (!result.data) return setError(result.error || 'Could not change the review status.')
    onFileChange(result.data.file)
  }
  const reviewedNote = status === 'reviewed' && (
    <p className="text-xs text-ink-secondary">
      {`Reviewed${file.reviewed_by_name ? ` by ${file.reviewed_by_name}` : ''}${file.reviewed_at ? ` · ${formatShortDateTime(file.reviewed_at, '')}` : ''}`}
    </p>
  )
  const spinner = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />

  return (
    <div className="space-y-2" role="group" aria-label="Review status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Review</span>
        {status === 'none' ? <Badge>Not sent for review</Badge> : <ReviewStatusBadge status={status} />}
      </div>
      {reviewedNote}
      {access.canChange && (access.staff ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={Boolean(saving) || status === 'reviewed'} onClick={() => void change('reviewed')}>
            {saving === 'reviewed' ? spinner : <BadgeCheck className="h-4 w-4" aria-hidden="true" />}
            Mark reviewed
          </Button>
          <Button size="sm" variant="secondary" disabled={Boolean(saving) || status === 'needs_review'} onClick={() => void change('needs_review')}>
            {saving === 'needs_review' ? spinner : <CircleDot className="h-4 w-4" aria-hidden="true" />}
            Needs review
          </Button>
          {status !== 'none' && (
            <Button size="sm" variant="quiet" disabled={Boolean(saving)} onClick={() => void change('none')}>
              {saving === 'none' ? spinner : <Undo2 className="h-4 w-4" aria-hidden="true" />}
              Clear
            </Button>
          )}
        </div>
      ) : (
        <Button size="sm" variant={status === 'needs_review' ? 'primary' : 'secondary'} aria-pressed={status === 'needs_review'} disabled={Boolean(saving)}
          onClick={() => void change(status === 'needs_review' ? 'none' : 'needs_review')}>
          {saving ? spinner : status === 'needs_review' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {status === 'reviewed' ? 'Ask for another review' : 'Ready for review'}
        </Button>
      ))}
      {!access.canChange && !access.staff && <p className="text-xs text-ink-muted">Reviews and comments are read only while your course is paused or your access has ended.</p>}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </div>
  )
}

export interface CohortFileCommentsSnapshot {
  comments: CohortFileComment[]
  canComment: boolean
}

/** The comment thread between a student and staff on one student-folder item. */
export function CohortFileComments({
  cohortId,
  file,
  onCountChange,
  draft: controlledDraft,
  onDraftChange,
  initialSnapshot,
  onSnapshotChange,
  posting: controlledPosting,
  postError: controlledPostError,
  onSubmitComment,
}: {
  cohortId: number
  file: CohortFile
  onCountChange?: (count: number) => void
  draft?: string
  onDraftChange?: (value: string) => void
  initialSnapshot?: CohortFileCommentsSnapshot | null
  onSnapshotChange?: (snapshot: CohortFileCommentsSnapshot) => void
  posting?: boolean
  postError?: string
  onSubmitComment?: (body: string) => Promise<void>
}) {
  const id = useId()
  const confirm = useConfirm()
  const [localComments, setLocalComments] = useState<CohortFileComment[] | null>(() => initialSnapshot?.comments ?? null)
  const [localCanComment, setLocalCanComment] = useState(() => initialSnapshot?.canComment ?? false)
  const comments = initialSnapshot ? initialSnapshot.comments : localComments
  const canComment = initialSnapshot ? initialSnapshot.canComment : localCanComment
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [localDraft, setLocalDraft] = useState('')
  const draft = controlledDraft ?? localDraft
  const setDraft = onDraftChange ?? setLocalDraft
  const [localPosting, setLocalPosting] = useState(false)
  const posting = controlledPosting ?? localPosting
  const [localError, setLocalError] = useState('')
  const error = controlledPostError || localError
  const onSnapshotChangeRef = useRef(onSnapshotChange)
  onSnapshotChangeRef.current = onSnapshotChange

  const hasInitialSnapshotRef = useRef(Boolean(initialSnapshot))
  hasInitialSnapshotRef.current = Boolean(initialSnapshot)

  useEffect(() => {
    if (attempt === 0 && hasInitialSnapshotRef.current) return
    let live = true
    setLoadError('')
    void api.getCohortFileComments(cohortId, file.id).then((result) => {
      if (!live) return
      if (result.data) {
        setLocalComments(result.data.comments)
        setLocalCanComment(result.data.can_comment)
        onSnapshotChangeRef.current?.({ comments: result.data.comments, canComment: result.data.can_comment })
      } else setLoadError(result.error || 'Could not load comments.')
    })
    return () => { live = false }
  }, [attempt, cohortId, file.id])

  const post = async () => {
    const body = draft.trim()
    if (!body || posting || body.length > MAX_COMMENT_LENGTH) return
    if (onSubmitComment) {
      await onSubmitComment(body)
      return
    }
    setLocalPosting(true)
    setLocalError('')
    const result = await api.createCohortFileComment(cohortId, file.id, body)
    setLocalPosting(false)
    if (!result.data) return setLocalError(result.error || 'Could not post your comment.')
    const next = [...(comments || []), result.data.comment]
    setLocalComments(next)
    onSnapshotChangeRef.current?.({ comments: next, canComment })
    setDraft('')
    onCountChange?.(next.length)
  }
  const remove = async (comment: CohortFileComment) => {
    const ok = await confirm({ title: 'Delete this comment?', description: 'It is removed for everyone who can see this file.', confirmLabel: 'Delete comment', tone: 'danger' })
    if (!ok) return
    const result = await api.deleteCohortFileComment(cohortId, file.id, comment.id)
    if (result.error) return setLocalError(result.error)
    const next = (comments || []).filter((item) => item.id !== comment.id)
    setLocalComments(next)
    onSnapshotChangeRef.current?.({ comments: next, canComment })
    onCountChange?.(next.length)
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h3 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquare className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        Comments
      </h3>
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-ink">
          <span>{loadError}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : comments === null ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-ink-muted">No comments yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Comments">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-xl border border-line bg-surface-sunken px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-xs text-ink-secondary [overflow-wrap:anywhere]">
                  <span className="font-semibold text-ink">{comment.author_name}</span>
                  {comment.author_role === 'staff' ? ' · Instructor' : ''} · {formatShortDateTime(comment.created_at, '')}
                </p>
                {comment.can_delete && (
                  <IconButton size="sm" className="-my-1 shrink-0" label={`Delete comment from ${comment.author_name}`} onClick={() => void remove(comment)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void post() }}>
          <label htmlFor={`${id}-draft`} className="block text-sm font-medium text-ink">Add a comment</label>
          <textarea id={`${id}-draft`} className="app-control w-full" rows={3} value={draft} maxLength={MAX_COMMENT_LENGTH} disabled={posting}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void post() } }} />
          {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
          <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
            {posting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {posting ? 'Posting…' : 'Post comment'}
          </Button>
        </form>
      )}
      {!canComment && error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </section>
  )
}

/** Review status and comments together, beside a doc or preview. */
export function CohortFileReviewPanel({
  cohortId,
  file,
  access,
  onFileChange,
  draft,
  onDraftChange,
  initialCommentsSnapshot,
  onCommentsSnapshotChange,
  postingComment,
  commentPostError,
  onSubmitComment,
}: {
  cohortId: number
  file: CohortFile
  access: ReviewAccess
  onFileChange: (file: CohortFile) => void
  draft?: string
  onDraftChange?: (value: string) => void
  initialCommentsSnapshot?: CohortFileCommentsSnapshot | null
  onCommentsSnapshotChange?: (snapshot: CohortFileCommentsSnapshot) => void
  postingComment?: boolean
  commentPostError?: string
  onSubmitComment?: (body: string) => Promise<void>
}) {
  return (
    <div className="space-y-5">
      <CohortFileReviewBar cohortId={cohortId} file={file} access={access} onFileChange={onFileChange} />
      <CohortFileComments
        cohortId={cohortId}
        file={file}
        draft={draft}
        onDraftChange={onDraftChange}
        initialSnapshot={initialCommentsSnapshot}
        onSnapshotChange={onCommentsSnapshotChange}
        posting={postingComment}
        postError={commentPostError}
        onSubmitComment={onSubmitComment}
        onCountChange={(count) => onFileChange({ ...file, comment_count: count })}
      />
    </div>
  )
}

/** Review and comments for an item with nothing to show in the app (a link, an Office file). */
export function CohortFileReviewModal({ cohortId, file, access, open, onClose, onFileChange }: {
  cohortId: number
  file: CohortFile
  access: ReviewAccess
  open: boolean
  onClose: () => void
  onFileChange: (file: CohortFile) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={file.title} subtitle="Review and comments" size="md">
      <CohortFileReviewPanel cohortId={cohortId} file={file} access={access} onFileChange={onFileChange} />
    </Modal>
  )
}
