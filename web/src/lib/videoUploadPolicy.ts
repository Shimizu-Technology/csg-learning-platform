// API upload endpoints revalidate MIME and enforce 1 byte through 5 GiB.
export const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024;
const TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' };
export function videoContentType(name: string, mime: string) {
  if (mime.startsWith('video/')) return mime;
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return Object.prototype.hasOwnProperty.call(TYPES, extension) ? TYPES[extension] : null;
}
export function validVideoSize(size: number) {
  return Number.isFinite(size) && size > 0 && size <= MAX_VIDEO_SIZE;
}
