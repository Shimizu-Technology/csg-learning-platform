import { BadgeCheck, CircleDashed } from 'lucide-react'
import { Badge, type BadgeTone } from '../ui/Badge'
import type { Rubric, RubricRating } from '../../types/api'

const labels: Record<RubricRating, string> = {
  exceeds: 'Exceeds',
  meets: 'Meets',
  developing: 'Developing',
  redo: 'Needs revision',
}

const tones: Record<RubricRating, BadgeTone> = {
  exceeds: 'success',
  meets: 'success',
  developing: 'pending',
  redo: 'warning',
}

export function RubricPanel({ rubric }: { rubric?: Rubric | null }) {
  if (!rubric) return null
  const reviewed = rubric.criteria.some((criterion) => criterion.rating)
  return <section className="app-surface p-5" aria-label={`Rubric: ${rubric.title}`}>
    <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">{reviewed ? <BadgeCheck className="h-5 w-5" aria-hidden="true" /> : <CircleDashed className="h-5 w-5" aria-hidden="true" />}</span><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">{reviewed ? 'Your criterion feedback' : 'How this work will be reviewed'}</p><h3 className="mt-1 text-base font-bold text-ink [overflow-wrap:anywhere]">{rubric.title}</h3>{rubric.description && <p className="mt-1 text-sm leading-6 text-ink-secondary">{rubric.description}</p>}</div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{rubric.criteria.map((criterion) => <article key={criterion.id} className="min-w-0 rounded-xl border border-line bg-surface-raised p-4"><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{criterion.title}</p>{criterion.rating && <Badge tone={tones[criterion.rating]}>{labels[criterion.rating]}</Badge>}</div><p className="mt-1 text-xs leading-5 text-ink-secondary">{criterion.description}</p>{criterion.feedback && <p className="mt-3 border-l-2 border-line-strong pl-3 text-sm leading-6 text-ink">{criterion.feedback}</p>}</article>)}</div>
  </section>
}
