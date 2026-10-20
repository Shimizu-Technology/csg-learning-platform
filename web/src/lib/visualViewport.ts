import { useEffect } from 'react'

/** A visual viewport shorter than the layout viewport by more than this is treated as an on-screen keyboard. */
export const KEYBOARD_THRESHOLD_PX = 120

export interface ViewportMetrics {
  /** Visible height in CSS px. */
  height: number
  /** How far the visible area is panned down inside the layout viewport. */
  top: number
  /** Space taken by the on-screen keyboard (0 when closed). */
  keyboardInset: number
  keyboardOpen: boolean
}

interface VisualViewportLike {
  height: number
  offsetTop: number
}

/** Reads the keyboard inset the way iOS Safari reports it: the layout viewport keeps its height and the visual viewport shrinks. */
export function measureViewport(layoutHeight: number, viewport: VisualViewportLike): ViewportMetrics {
  const height = Math.max(0, Math.round(viewport.height))
  const top = Math.max(0, Math.round(viewport.offsetTop))
  const inset = Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop))
  const keyboardOpen = inset > KEYBOARD_THRESHOLD_PX
  return { height, top, keyboardInset: keyboardOpen ? inset : 0, keyboardOpen }
}

const PROPERTIES = ['--visual-viewport-height', '--visual-viewport-top', '--keyboard-inset'] as const

/**
 * Keeps a full-height screen (Messages) above the iOS keyboard. iOS Safari does
 * not shrink `dvh` when the keyboard opens; it shrinks only the visual viewport
 * and pans it. While the keyboard is open this publishes the visible height and
 * offset as CSS variables and sets `data-keyboard="open"` on <html>, so CSS can
 * pin the shell to the visible area and hide the bottom navigation.
 * Android Chrome resizes the layout viewport itself, so the inset stays 0 there.
 */
export function useKeyboardAwareViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    let frame = 0

    const apply = () => {
      const metrics = measureViewport(window.innerHeight, viewport)
      if (metrics.keyboardOpen) {
        root.style.setProperty('--visual-viewport-height', `${metrics.height}px`)
        root.style.setProperty('--visual-viewport-top', `${metrics.top}px`)
        root.style.setProperty('--keyboard-inset', `${metrics.keyboardInset}px`)
        root.dataset.keyboard = 'open'
      } else {
        PROPERTIES.forEach((property) => root.style.removeProperty(property))
        delete root.dataset.keyboard
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }

    apply()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      PROPERTIES.forEach((property) => root.style.removeProperty(property))
      delete root.dataset.keyboard
    }
  }, [enabled])
}
