import { lazy, Suspense } from 'react'
import type { MarkdownEditorProps } from './MarkdownEditor'

const MarkdownEditor = lazy(() => import('./MarkdownEditor/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })))

/**
 * The shared editor, loaded when it's first shown. Pages most people only
 * read (lessons, updates) don't download the rich-text engine until someone
 * writes. The placeholder keeps the editor's size and shows the text.
 */
export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense
      fallback={(
        <div
          aria-busy="true"
          className={`whitespace-pre-wrap rounded-xl border border-line-strong bg-surface-raised px-3 py-2.5 text-base text-ink-muted sm:text-sm ${props.className || ''}`}
          style={{ minHeight: (props.minHeight ?? 112) + 45 }}
        >
          {props.value || props.defaultValue || props.placeholder}
        </div>
      )}
    >
      <MarkdownEditor {...props} />
    </Suspense>
  )
}
