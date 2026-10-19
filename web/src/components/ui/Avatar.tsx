import { useState } from 'react'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

/** Up to two initials from a display name ("Maria Santos" -> "MS"). */
export function initialsFor(name: string | null | undefined) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]]
  return letters.map((part) => Array.from(part)[0] || '').join('').toUpperCase()
}

interface AvatarProps {
  name: string | null | undefined
  src?: string | null
  size?: AvatarSize
  className?: string
}

/**
 * One avatar for the app: the person's photo when there is one, otherwise
 * initials on a tinted neutral circle. Decorative: the name is always shown
 * or announced next to it, so the image itself has empty alt text.
 */
export function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed
  return (
    <span
      aria-hidden="true"
      data-avatar={showImage ? 'photo' : 'initials'}
      className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-700 ring-1 ring-inset ring-slate-900/5 ${SIZES[size]} ${className}`.trim()}
    >
      {showImage ? (
        <img src={src!} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initialsFor(name)
      )}
    </span>
  )
}
