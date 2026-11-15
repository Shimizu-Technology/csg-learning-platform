interface GradeDisplayProps {
  grade: string | null
  size?: 'sm' | 'md' | 'lg'
}

const gradeColors: Record<string, string> = {
  A: 'bg-success-soft text-success-ink border-success-line',
  B: 'bg-info-soft text-info-ink border-info-line',
  C: 'bg-surface-sunken text-ink-secondary border-line',
  R: 'bg-warning-soft text-warning-ink border-warning-line',
}

const gradeLabels: Record<string, string> = {
  A: 'Excellent',
  B: 'Good',
  C: 'Satisfactory',
  R: 'Redo',
}

export function GradeDisplay({ grade, size = 'md' }: GradeDisplayProps) {
  if (!grade) return null

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border font-semibold ${gradeColors[grade] || 'bg-surface-sunken text-ink-secondary border-line'} ${sizeClasses[size]}`}
    >
      {grade}
      {size !== 'sm' && <span className="font-medium">· {gradeLabels[grade]}</span>}
    </span>
  )
}
