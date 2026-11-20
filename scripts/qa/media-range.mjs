// Parses a single `bytes=` Range header against a file size (RFC 9110).
// Returns { start, end, partial } for a satisfiable request, or null for 416.
export function byteRange(header, size) {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === '' && match[2] === '')) return { start: 0, end: size - 1, partial: false }
  if (match[1] === '') {
    const suffix = Math.min(Number(match[2]), size)
    return suffix > 0 ? { start: size - suffix, end: size - 1, partial: true } : null
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return start < size && start <= end ? { start, end, partial: true } : null
}

// Writes `media` as an MP4 response, honouring a single byte range.
export function sendMedia(request, response, media) {
  const range = byteRange(request.headers.range, media.length)
  response.setHeader('Accept-Ranges', 'bytes')
  if (!range) {
    response.statusCode = 416
    response.setHeader('Content-Range', `bytes */${media.length}`)
    return response.end()
  }
  const { start, end, partial } = range
  response.statusCode = partial ? 206 : 200
  response.setHeader('Content-Type', 'video/mp4')
  response.setHeader('Content-Length', String(end - start + 1))
  if (partial) response.setHeader('Content-Range', `bytes ${start}-${end}/${media.length}`)
  response.end(media.subarray(start, end + 1))
}
