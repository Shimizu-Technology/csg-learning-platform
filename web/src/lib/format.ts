export function formatShortDateTime(dateStr: string | null | undefined, fallback = 'TBD'): string {
  if (!dateStr) return fallback

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return fallback

  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
