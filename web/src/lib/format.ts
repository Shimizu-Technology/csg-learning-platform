export function formatShortDateTime(
  dateStr: string | null | undefined,
  fallback = 'TBD',
  timeZone?: string,
): string {
  if (!dateStr) return fallback

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return fallback

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  if (timeZone) {
    options.timeZone = timeZone
    options.timeZoneName = 'short'
  }

  return date.toLocaleString('en-US', options)
}
