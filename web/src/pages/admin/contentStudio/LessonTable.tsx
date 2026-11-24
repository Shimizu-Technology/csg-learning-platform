import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Eye, Pencil } from 'lucide-react'
import { listLinkState } from '../../../lib/navigationContext'
import { lessonEditorPath } from '../../../lib/routes'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'

export interface Lesson {
  id: number
  title: string
  lesson_type: string
  position: number
  release_day: number
  requires_submission?: boolean
  submission_type?: string
  published?: boolean
  content_blocks_count: number
  archived_at: string | null
  updated_at: string
}

// Keep row extensions in one slot: lesson move/duplicate belongs to W5.3.
export function LessonRow({
  lesson,
  canEdit,
  actions
}: {
  lesson: Lesson
  canEdit: boolean
  actions?: React.ReactNode
}) {
  const location = useLocation()
  const state = listLinkState(location, 'Content')
  return (
    <tr className="border-b border-line hover:bg-surface-sunken">
      <td className="min-w-0 px-3 py-1">
        <RecordLink
          record={{ type: 'lesson', id: lesson.id, view: canEdit ? 'edit' : undefined }}
          returnLabel="Content"
          className="flex min-h-11 min-w-0 items-center break-words text-sm font-semibold hover:underline"
        >
          {lesson.title}
        </RecordLink>
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className="text-xs text-ink-muted">
            {lesson.content_blocks_count} {lesson.content_blocks_count === 1 ? 'block' : 'blocks'}
          </span>
          {lesson.published === false && (
            <Badge tone="warning">Draft</Badge>
          )}
          {lesson.submission_type && lesson.submission_type !== 'manual_complete' && (
            <Badge tone="neutral">
              {lesson.submission_type.includes('repo') || lesson.submission_type.includes('github')
                ? lesson.submission_type === 'repo_and_live_url_submission' ? 'GitHub repo + live URL' : 'GitHub repo'
                : 'Submission'}
            </Badge>
          )}
        </div>
      </td>
      <td className="w-24 px-1 py-1">
        <div className="flex flex-wrap items-center justify-end">
          <LinkButton
            variant="quiet"
            to={lessonEditorPath(lesson.id, { preview: true })}
            state={state}
            aria-label={`Preview ${lesson.title} as a student`}
          >
            <Eye className="h-4 w-4" />
          </LinkButton>
          {canEdit && (
            <LinkButton
              variant="quiet"
              to={lessonEditorPath(lesson.id)}
              state={state}
              aria-label={`Edit ${lesson.title}`}
            >
              <Pencil className="h-4 w-4" />
            </LinkButton>
          )}
          {actions}
        </div>
      </td>
    </tr>
  )
}
export function SequenceLessons({ lessons, canEdit }: { lessons: Lesson[]; canEdit: boolean }) {
  const [sort, setSort] = useState<'position' | 'title'>('position')
  return (
    <section aria-label="Lesson sequence">
      <label className="mb-3 block text-sm">
        Sort lessons
        <select
          className="app-control ml-2"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="position">Sequence order</option>
          <option value="title">Title</option>
        </select>
      </label>
      <table className="w-full table-fixed" aria-label="Lesson sequence">
        <thead className="sr-only">
          <tr>
            <th scope="col">Lesson and submission type</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...lessons]
            .sort((a, b) =>
              sort === 'title'
                ? a.title.localeCompare(b.title)
                : a.release_day - b.release_day || a.position - b.position || a.id - b.id
            )
            .map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} canEdit={canEdit} />
            ))}
        </tbody>
      </table>
      {!lessons.length && (
        <p className="text-sm text-ink-muted">No lessons yet. Add an exercise to start the sequence.</p>
      )}
    </section>
  )
}
