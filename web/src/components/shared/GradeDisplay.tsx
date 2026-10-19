interface GradeDisplayProps {
  grade: string | null
  size?: 'sm' | 'md' | 'lg'
}

const gradeColors: Record<string, string> = {
  A: 'bg-success-50 text-success-700 border-success-200',
  B: 'bg-info-50 text-info-800 border-info-200',
  C: 'bg-pending-50 text-pending-700 border-pending-200',
  R: 'bg-warning-50 text-warning-800 border-warning-200',
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
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border font-semibold ${gradeColors[grade] || 'bg-slate-100 text-slate-700 border-slate-200'} ${sizeClasses[size]}`}
    >
      {grade}
      {size !== 'sm' && <span className="font-medium">· {gradeLabels[grade]}</span>}
    </span>
  )
}
