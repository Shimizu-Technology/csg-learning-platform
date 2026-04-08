const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:']

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (ALLOWED_PROTOCOLS.includes(parsed.protocol)) return url
  } catch {
    // relative URLs or malformed — block them
  }
  return '#'
}
