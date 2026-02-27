interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  showPercentage?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function ProgressBar({ value, max = 100, label, showPercentage = true, size = 'md' }: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  const heightClass = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-4' : 'h-2.5'

  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-sm font-medium text-slate-700">{label}</span>}
          {showPercentage && <span className="text-sm font-medium text-slate-500">{percentage}%</span>}
        </div>
      )}
      <div className={`w-full rounded-full bg-slate-200 ${heightClass}`}>
        <div
          className={`rounded-full bg-primary-500 transition-all duration-500 ${heightClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
