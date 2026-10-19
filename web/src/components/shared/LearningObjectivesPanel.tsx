import { CheckCircle2, Target } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { LessonObjective } from '../../types/api'

type Props = {
  objectives: LessonObjective[]
  preview?: boolean
}

export function LearningObjectivesPanel({ objectives, preview = false }: Props) {
  const visible = objectives.filter((objective) => objective.active)
  if (!visible.length) return null

  return (
    <section aria-labelledby="lesson-objectives-heading" className="app-surface p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-sunken text-ink-secondary">
          <Target className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">Before you begin</p>
          <h2 id="lesson-objectives-heading" className="mt-1 text-lg font-bold tracking-tight text-ink">What success looks like</h2>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {visible.map((objective) => (
          <div key={`${objective.id}-${objective.content_block_id || 'lesson'}`} className="rounded-2xl border border-line bg-surface-raised p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span>
                  {objective.content_block_title && <span className="text-xs font-semibold text-ink-muted [overflow-wrap:anywhere]">For {objective.content_block_title}</span>}
                  {preview && <Badge tone="info">Preview</Badge>}
                </div>
                <h3 className="mt-2 text-sm font-bold text-ink [overflow-wrap:anywhere] sm:text-base">{objective.title}</h3>
                {objective.description && <p className="mt-1 text-sm leading-6 text-ink-secondary">{objective.description}</p>}
                <p className="mt-2 border-l-2 border-line-strong pl-3 text-sm font-semibold leading-6 text-ink">{objective.success_criteria}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
