function httpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export function getYouTubeId(value: string): string | null {
  const url = httpsUrl(value)
  if (!url) return null
  const host = url.hostname
  const parts = url.pathname.split('/').filter(Boolean)
  const youtube = ['youtube.com', 'youtube-nocookie.com'].some((domain) => host === domain || host.endsWith(`.${domain}`))
  const id = host.replace(/^www\./, '').replace(/^m\./, '') === 'youtu.be' ? parts[0] : youtube
    ? url.searchParams.get('v') || (['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null)
    : null
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null
}

export function getVimeoEmbed(value: string): { id: string; hash?: string } | null {
  const url = httpsUrl(value)
  if (!url || (url.hostname !== 'vimeo.com' && !url.hostname.endsWith('.vimeo.com'))) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[0] === 'video' ? parts[1] : [...parts].reverse().find((part) => /^\d+$/.test(part))
  if (!id || !/^\d+$/.test(id)) return null
  const hash = url.searchParams.get('h') || parts[parts.lastIndexOf(id) + 1]
  return { id, hash: hash && /^[A-Za-z0-9]+$/.test(hash) ? hash : undefined }
}
