import type { CsgApi } from './api';
import { MAX_VIDEO_SIZE, MULTIPART_VIDEO_THRESHOLD, uploadVideoToStorage, validateVideoAsset, type VideoUploadAsset } from './video-upload';

export const MULTIPART_THRESHOLD = MULTIPART_VIDEO_THRESHOLD;
export const MAX_RECORDING_SIZE = MAX_VIDEO_SIZE;
export type RecordingUploadAsset = VideoUploadAsset;

interface UploadRecordingOptions {
  api: CsgApi;
  asset: RecordingUploadAsset;
  cohortId: number;
  title: string;
  description?: string;
  recordedDate?: string;
  publishImmediately?: boolean;
  onProgress?: (percent: number, label: string) => void;
}

export async function uploadRecording({
  api,
  asset,
  cohortId,
  title,
  description,
  recordedDate,
  publishImmediately = false,
  onProgress,
}: UploadRecordingOptions) {
  validateVideoAsset(asset);
  let uploadedKey: string | null = null;

  try {
    const s3Key = await uploadVideoToStorage({ api, asset, target: { kind: 'recording', cohortId }, onProgress });
    uploadedKey = s3Key;
    onProgress?.(100, publishImmediately ? 'Publishing recording…' : 'Saving draft…');

    return await api.createRecording(cohortId, {
      title: title.trim(),
      description: description?.trim() || undefined,
      recorded_date: recordedDate || undefined,
      s3_key: s3Key,
      content_type: asset.mimeType,
      file_size: asset.size,
      publish_immediately: publishImmediately,
    });
  } catch (error) {
    if (uploadedKey) await api.abandonUpload(uploadedKey).catch(() => undefined);
    throw error;
  }
}
