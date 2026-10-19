import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClerk, useUser } from '@clerk/clerk-react'
import { ChevronUp, LogOut, Settings, UserRound } from 'lucide-react'
import { Avatar } from '../ui/Avatar'

interface AccountMenuProps {
  name: string
  role?: string | null
  avatarUrl?: string | null
  /** Collapsed desktop sidebar: show only the avatar. */
  compact?: boolean
  onNavigate?: () => void
}

/**
 * The signed-in person's account control: one Avatar (photo or initials,
 * never Clerk's generated default) that opens a small menu with Profile,
 * account management, and Sign out.
 */
export function AccountMenu({ name, role, avatarUrl, compact = false, onNavigate }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const { signOut, openUserProfile } = useClerk()
  const { user: clerkUser } = useUser()
  const photo = avatarUrl || (clerkUser?.hasImage ? clerkUser.imageUrl : null)

  useEffect(() => {
    if (!open) return
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])
    const frame = requestAnimationFrame(() => items()[0]?.focus())

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const list = items()
      if (!list.length) return
      event.preventDefault()
      const index = list.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length
      list[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    onNavigate?.()
  }

  const itemClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken active:bg-slate-200/70'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={compact ? `Account menu for ${name}` : undefined}
        title={compact ? name : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`pressable flex min-h-12 w-full min-w-0 items-center rounded-xl text-left hover:bg-surface-sunken ${compact ? 'justify-center px-1' : 'gap-3 px-2'} ${open ? 'bg-surface-sunken' : ''}`}
      >
        <Avatar name={name} src={photo} size={compact ? 'sm' : 'md'} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{name}</span>
              {role && <span className="block truncate text-xs capitalize text-ink-muted">{role}</span>}
            </span>
            <ChevronUp className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-[180ms] ${open ? '' : 'rotate-180'}`} aria-hidden="true" />
          </>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className={`account-menu absolute bottom-full z-50 mb-2 w-60 rounded-xl border border-line bg-surface-raised p-1.5 shadow-overlay ${compact ? 'left-0' : 'left-0 right-0 w-auto'}`}
        >
          <Link role="menuitem" to="/profile" onClick={close} className={itemClass}>
            <UserRound className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Profile and settings
          </Link>
          <button role="menuitem" type="button" onClick={() => { close(); openUserProfile() }} className={itemClass}>
            <Settings className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Sign-in and security
          </button>
          <div className="my-1 border-t border-line" role="separator" />
          <button role="menuitem" type="button" onClick={() => { close(); void signOut({ redirectUrl: '/sign-in' }) }} className={itemClass}>
            <LogOut className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
