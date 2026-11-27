export interface VideoVersion {
  id: string;
  label: string;
  s3_video_key: string;
}

export function videoVersions(metadata: Record<string, unknown> | null | undefined): VideoVersion[] {
  if (!Array.isArray(metadata?.video_versions)) return [];
  return metadata.video_versions.filter(
    (item): item is VideoVersion =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).label === 'string' &&
      typeof (item as Record<string, unknown>).s3_video_key === 'string',
  );
}
