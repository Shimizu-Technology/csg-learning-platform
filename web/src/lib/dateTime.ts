export function toDateTimeInputValueInTimeZone(
  dateStr: string | null | undefined,
  timeZone: string,
): string {
  if (!dateStr) return ''

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function toLocalDateTimeInputValue(
  dateStr: string | null | undefined,
): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return toDateTimeInputValueInTimeZone(dateStr, timeZone)
}
