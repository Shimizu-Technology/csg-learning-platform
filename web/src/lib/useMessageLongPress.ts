import { useEffect, useRef, type PointerEvent } from 'react'

// Never capture the pointer or prevent its default: scrolling, selection, links,
// and attachment controls keep their browser behavior.
export function useMessageLongPress(open: () => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number; id: number } | null>(null)
  const opened = useRef(false)
  const detach = useRef<(() => void) | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
    detach.current?.()
    detach.current = null
  }
  const attach = () => {
    const cancelSelection = () => { if (window.getSelection()?.toString()) cancel() }
    document.addEventListener('scroll', cancel, true)
    document.addEventListener('selectionchange', cancelSelection)
    window.addEventListener('blur', cancel)
    detach.current = () => {
      document.removeEventListener('scroll', cancel, true)
      document.removeEventListener('selectionchange', cancelSelection)
      window.removeEventListener('blur', cancel)
    }
  }
  useEffect(() => () => cancel(), [])
  useEffect(() => { if (!enabled) cancel() }, [enabled])
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      cancel()
      opened.current = false
      if (!enabled || event.pointerType !== 'touch' || event.isPrimary === false) return
      if ((event.target as Element).closest('a,button,input,textarea,select,[contenteditable="true"],[role="button"]')) return
      if (window.getSelection()?.toString()) return
      origin.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
      timer.current = setTimeout(() => {
        if (!origin.current || window.getSelection()?.toString()) { cancel(); return }
        opened.current = true
        cancel()
        open()
      }, 500)
      attach()
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = origin.current
      if (start && (event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => { if (opened.current) event.preventDefault() },
  }
}
