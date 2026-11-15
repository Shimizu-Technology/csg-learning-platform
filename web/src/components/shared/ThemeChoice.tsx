import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { SegmentButton, SegmentedControl } from '../ui/Choice'
import { useTheme, type ThemePreference } from '../../lib/theme'

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Light / Dark / System (design spec §7). Used in Profile › Appearance and the
 * public footer; the account menu has the same three choices as menu items.
 * The choice is saved on this device and applies straight away.
 */
export function ThemeChoice({ className = '', dense = false }: { className?: string; dense?: boolean }) {
  const { preference, setPreference } = useTheme()
  return (
    <SegmentedControl label="Theme" className={className}>
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <SegmentButton key={value} dense={dense} selected={preference === value} onClick={() => setPreference(value)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </SegmentButton>
      ))}
    </SegmentedControl>
  )
}
