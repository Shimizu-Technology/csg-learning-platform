export interface VideoVersion { id: string; label: string; s3_video_key: string }
export function videoVersions(metadata: Record<string, unknown> | null | undefined): VideoVersion[] {
  return Array.isArray(metadata?.video_versions) ? metadata.video_versions.filter((item): item is VideoVersion =>
    item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.s3_video_key === 'string') : []
}
export function rememberedVersion(blockId: number, versions: VideoVersion[]) {
  try {
    const id = localStorage.getItem(`video-version:${blockId}`)
    if (versions.some((v) => v.id === id)) return id!
  } catch { /* Browser storage is optional. */ }
  return versions[0]?.id
}
