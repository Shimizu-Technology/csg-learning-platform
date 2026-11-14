import { Bot } from 'lucide-react'

/** Small, quiet label for messages an admin's assistant posted with a scoped token. */
export function SentViaIndicator({ label }: { label?: string | null }) {
  const name = label?.trim()
  if (!name) return null

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-ink-muted" title={`Posted by an assistant using the "${name}" token`}>
      <Bot className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">Sent via {name}</span>
    </span>
  )
}
