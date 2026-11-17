/** A grade as a small square chip: A, B, C in success tones, R (Redo) in warning tones. */
export function GradeChip({ grade }: { grade: string | null }) {
  const redo = grade === 'R'
  return <span aria-label={redo ? 'Redo' : `Grade ${grade ?? ''}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${redo ? 'border-warning-line bg-warning-soft text-warning-ink' : 'border-success-line bg-success-soft text-success-ink'}`}>{grade}</span>
}
