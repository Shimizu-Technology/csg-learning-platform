import { BadgeCheck, CircleDashed } from 'lucide-react'
import type { Rubric, RubricRating } from '../../types/api'

const labels: Record<RubricRating, string> = {
  exceeds: 'Exceeds',
  meets: 'Meets',
  developing: 'Developing',
  redo: 'Needs revision',
}

export function RubricPanel({ rubric }: { rubric?: Rubric | null }) {
  if (!rubric) return null
  const reviewed = rubric.criteria.some((criterion) => criterion.rating)
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5" aria-label={`Rubric: ${rubric.title}`}>
    <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">{reviewed ? <BadgeCheck className="h-5 w-5" /> : <CircleDashed className="h-5 w-5" />}</span><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">{reviewed ? 'Your criterion feedback' : 'How this work will be reviewed'}</p><h3 className="mt-1 text-base font-extrabold text-slate-950">{rubric.title}</h3>{rubric.description && <p className="mt-1 text-sm leading-6 text-slate-600">{rubric.description}</p>}</div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{rubric.criteria.map((criterion) => <article key={criterion.id} className="rounded-xl border border-emerald-100 bg-white p-4"><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-slate-900">{criterion.title}</p>{criterion.rating && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800">{labels[criterion.rating]}</span>}</div><p className="mt-1 text-xs leading-5 text-slate-600">{criterion.description}</p>{criterion.feedback && <p className="mt-3 border-l-2 border-emerald-300 pl-3 text-sm leading-6 text-slate-700">{criterion.feedback}</p>}</article>)}</div>
  </section>
}
