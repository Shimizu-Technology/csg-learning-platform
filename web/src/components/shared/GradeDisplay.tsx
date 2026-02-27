interface GradeDisplayProps {
  grade: string | null
  size?: 'sm' | 'md' | 'lg'
}

const gradeColors: Record<string, string> = {
  A: 'bg-success-100 text-success-700 border-success-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-amber-100 text-amber-700 border-amber-200',
  R: 'bg-primary-100 text-primary-700 border-primary-200',
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
      className={`inline-flex items-center gap-1 rounded-lg border font-semibold ${gradeColors[grade] || 'bg-slate-100 text-slate-700 border-slate-200'} ${sizeClasses[size]}`}
    >
      {grade}
      {size !== 'sm' && <span className="font-normal opacity-75">· {gradeLabels[grade]}</span>}
    </span>
  )
}
