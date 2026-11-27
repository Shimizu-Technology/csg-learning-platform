let activeLockCount = 0
let savedOverflow = ''

/**
 * Reference-counted body scroll lock shared by modals, drawers, command palette,
 * and mobile navigation so overlapping overlays never restore stale `hidden` state.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (activeLockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  activeLockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    activeLockCount = Math.max(0, activeLockCount - 1)
    if (activeLockCount === 0) {
      document.body.style.overflow = savedOverflow
      savedOverflow = ''
    }
  }
}
