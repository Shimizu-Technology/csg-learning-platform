/** The school stores a phrase, e.g. "usually reviewed within 2 days". */
export function reviewTiming(phrase?: string | null): string {
  return (phrase?.trim() || 'usually reviewed within 2 days').replace(/\breviewed\s+/i, '')
}
