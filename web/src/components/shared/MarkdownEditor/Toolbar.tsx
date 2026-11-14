import { forwardRef, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bold, Braces, Code2, Italic, Link2, List, ListOrdered, TextQuote } from 'lucide-react'
import type { FormatAction } from './markdownSource'
import type { EditorMode } from './preferences'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+'
const ARIA_MOD = IS_MAC ? 'Meta' : 'Control'

export type ToolDefinition = {
  action: FormatAction
  label: string
  icon: ReactNode
  /** Shown after ⌘ / Ctrl+ in the tooltip. */
  key: string
  aria: string
}

const icon = 'h-4 w-4'
/** The §9.4 toolbar. Strikethrough has no button (⌘⇧X and ~~text~~ still work). */
export const TOOLS: ToolDefinition[] = [
  { action: 'bold', label: 'Bold', icon: <Bold className={icon} aria-hidden="true" />, key: 'B', aria: 'B' },
  { action: 'italic', label: 'Italic', icon: <Italic className={icon} aria-hidden="true" />, key: 'I', aria: 'I' },
  { action: 'code', label: 'Inline code', icon: <Code2 className={icon} aria-hidden="true" />, key: 'E', aria: 'E' },
  { action: 'codeBlock', label: 'Code block', icon: <Braces className={icon} aria-hidden="true" />, key: '⇧C', aria: 'Shift+C' },
  { action: 'bulletList', label: 'Bulleted list', icon: <List className={icon} aria-hidden="true" />, key: '⇧8', aria: 'Shift+8' },
  { action: 'orderedList', label: 'Numbered list', icon: <ListOrdered className={icon} aria-hidden="true" />, key: '⇧7', aria: 'Shift+7' },
  { action: 'blockquote', label: 'Quote', icon: <TextQuote className={icon} aria-hidden="true" />, key: '⇧9', aria: 'Shift+9' },
  { action: 'link', label: 'Link', icon: <Link2 className={icon} aria-hidden="true" />, key: '⇧U', aria: 'Shift+U' },
]

export const shortcutLabel = (tool: Pick<ToolDefinition, 'key'>) => `${MOD_LABEL}${tool.key}`
export const ariaShortcut = (tool: Pick<ToolDefinition, 'aria'>) => `${ARIA_MOD}+${tool.aria}`

type ToolbarButtonProps = {
  label: string
  shortcut?: string
  ariaKeyShortcuts?: string
  pressed?: boolean
  disabled?: boolean
  tabIndex?: number
  /** Phone menu: full 44px targets with a visible label. */
  large?: boolean
  /** Composer footer: 32px wide on desktop so the whole toolbar fits beside Send. */
  compact?: boolean
  className?: string
  children: ReactNode
  onClick: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
  expanded?: boolean
}

/** A toolbar button: keeps the editor's focus and selection, shows its shortcut in a tooltip. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { label, shortcut, ariaKeyShortcuts, pressed, disabled, tabIndex, large, compact, className = '', children, onClick, onKeyDown, expanded },
  ref,
) {
  const tooltipId = useId()
  const localRef = useRef<HTMLButtonElement | null>(null)
  const [tooltip, setTooltip] = useState<{ left: number; top: number } | null>(null)
  const show = () => {
    const button = localRef.current
    // No tooltip over an open menu, in the phone menu, or after a tap (only hover and keyboard focus).
    if (!button || large || expanded || typeof window === 'undefined') return
    if (document.activeElement === button && !button.matches(':focus-visible') && !button.matches(':hover')) return
    const rect = button.getBoundingClientRect()
    setTooltip({ left: Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16), top: rect.top - 10 })
  }
  const hide = () => setTooltip(null)

  return (
    <>
      <button
        ref={(element) => {
          localRef.current = element
          if (typeof ref === 'function') ref(element)
          else if (ref) ref.current = element
        }}
        type="button"
        aria-label={label}
        aria-keyshortcuts={ariaKeyShortcuts}
        aria-pressed={pressed === undefined ? undefined : pressed}
        aria-expanded={expanded}
        aria-describedby={tooltip ? tooltipId : undefined}
        data-active={pressed ? 'true' : undefined}
        disabled={disabled}
        tabIndex={tabIndex}
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          hide()
          onClick()
        }}
        onKeyDown={onKeyDown}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-xl text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-40 ${
          large ? 'min-h-11 min-w-11 px-3 text-sm font-semibold' : compact ? 'h-11 w-11 lg:h-9 lg:w-[30px]' : 'h-11 w-11 lg:h-9 lg:w-9'
        } ${pressed ? 'bg-slate-100 text-ink' : ''} ${className}`}
      >
        {children}
      </button>
      {tooltip && typeof document !== 'undefined' && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-overlay"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {label}
          {shortcut && <span className="ml-2 font-medium text-slate-300">{shortcut}</span>}
        </div>,
        document.body,
      )}
    </>
  )
})

/** Arrow keys move between a toolbar's buttons; the toolbar is one Tab stop (§9.8). */
export function useRovingFocus(count: number) {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let next: number | null = null
    if (event.key in moves) next = (index + moves[event.key] + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next === null) return
    event.preventDefault()
    setActive(next)
    refs.current[next]?.focus()
  }
  const props = (index: number) => ({
    ref: (element: HTMLButtonElement | null) => { refs.current[index] = element },
    tabIndex: index === Math.min(active, count - 1) ? 0 : -1,
    onKeyDown: onKeyDown(index),
  })
  return props
}

export function FormatButtons({
  pressed,
  disabled,
  large = false,
  compact = false,
  onAction,
}: {
  pressed: Partial<Record<FormatAction, boolean>>
  disabled: boolean
  large?: boolean
  compact?: boolean
  onAction: (action: FormatAction) => void
}) {
  const roving = useRovingFocus(TOOLS.length)
  return (
    <>
      {TOOLS.map((tool, index) => (
        <ToolbarButton
          key={tool.action}
          {...roving(index)}
          label={tool.label}
          shortcut={shortcutLabel(tool)}
          ariaKeyShortcuts={ariaShortcut(tool)}
          pressed={tool.action === 'link' ? undefined : Boolean(pressed[tool.action])}
          disabled={disabled}
          large={large}
          compact={compact}
          onClick={() => onAction(tool.action)}
        >
          {tool.icon}
          {large && <span className="sr-only">{tool.label}</span>}
        </ToolbarButton>
      ))}
    </>
  )
}

export function ModeToggle({ mode, onChange, className = 'inline-flex' }: { mode: EditorMode; onChange: (mode: EditorMode) => void; className?: string }) {
  const options: { value: EditorMode; label: string; title: string }[] = [
    { value: 'rich', label: 'Rich', title: 'Rich: formatting as you type' },
    { value: 'markdown', label: 'Markdown', title: 'Markdown: plain text with Preview' },
  ]
  return (
    <div role="group" aria-label="Editor mode" className={`shrink-0 rounded-xl border border-line bg-surface-sunken p-0.5 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          aria-keyshortcuts={`${ARIA_MOD}+Shift+M`}
          title={`${option.title} (${MOD_LABEL}⇧M)`}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.value)}
          className={`min-h-11 rounded-[10px] px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:min-h-8 ${
            mode === option.value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
