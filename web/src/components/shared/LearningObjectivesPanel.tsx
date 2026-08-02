import { CheckCircle2, Target } from 'lucide-react'
import type { LessonObjective } from '../../types/api'

type Props = {
  objectives: LessonObjective[]
  preview?: boolean
}

export function LearningObjectivesPanel({ objectives, preview = false }: Props) {
  const visible = objectives.filter((objective) => objective.active)
  if (!visible.length) return null

  return (
    <section aria-labelledby="lesson-objectives-heading" className="relative overflow-hidden rounded-[1.75rem] border border-primary-100 bg-[linear-gradient(135deg,#fff_0%,#fff7f8_100%)] p-5 shadow-[0_18px_45px_rgba(197,29,52,0.07)] sm:p-6">
      <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-primary-100/60 blur-2xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-[0_8px_22px_rgba(197,29,52,0.22)]">
            <Target className="h-5 w-5" />
          </span>
          <div>
            <p className="app-eyebrow">Before you begin</p>
            <h2 id="lesson-objectives-heading" className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">What success looks like</h2>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {visible.map((objective) => (
            <div key={`${objective.id}-${objective.content_block_id || 'lesson'}`} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_8px_26px_rgba(15,23,42,0.04)]">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[11px] font-bold tracking-wide text-slate-600">{objective.code}</span>
                    {objective.content_block_title && <span className="text-xs font-semibold text-slate-500">For {objective.content_block_title}</span>}
                    {preview && <span className="text-xs font-semibold text-primary-600">Preview</span>}
                  </div>
                  <h3 className="mt-2 text-sm font-extrabold text-slate-950 sm:text-base">{objective.title}</h3>
                  {objective.description && <p className="mt-1 text-sm leading-6 text-slate-600">{objective.description}</p>}
                  <p className="mt-2 border-l-2 border-primary-200 pl-3 text-sm font-semibold leading-6 text-slate-700">{objective.success_criteria}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
