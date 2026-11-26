import { Check } from 'lucide-react'

/** A grade as a small square chip: A, B, C and Pass (a check) in success tones, R (Redo) in warning tones. */
export function GradeChip({ grade }: { grade: string | null }) {
  const redo = grade === 'R'
  const pass = grade === 'P'
  return <span aria-label={redo ? 'Redo' : pass ? undefined : `Grade ${grade ?? ''}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${redo ? 'border-warning-line bg-warning-soft text-warning-ink' : 'border-success-line bg-success-soft text-success-ink'}`}>{pass ? <><Check className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Pass</span></> : grade}</span>
}
