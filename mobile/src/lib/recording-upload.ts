import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import type { CsgApi } from './api';

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
export const MAX_RECORDING_SIZE = 5 * 1024 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;
const MAX_ATTEMPTS = 4;

export interface RecordingUploadAsset {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

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
  if (asset.size <= 0) throw new Error('The selected video is empty.');
  if (asset.size > MAX_RECORDING_SIZE) throw new Error('Recordings must be 5 GB or smaller.');
  if (!asset.mimeType.startsWith('video/')) throw new Error('Choose a video file.');

  const file = new File(asset.uri);
  let uploadedKey: string | null = null;

  try {
    const s3Key = asset.size >= MULTIPART_THRESHOLD
      ? await uploadMultipart(api, file, asset, cohortId, onProgress)
      : await uploadPresignedPost(api, file, asset, cohortId, onProgress);
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

async function uploadPresignedPost(
  api: CsgApi,
  file: File,
  asset: RecordingUploadAsset,
  cohortId: number,
  onProgress?: (percent: number, label: string) => void,
) {
  onProgress?.(3, 'Preparing secure upload…');
  const signed = await api.presignRecordingUpload(cohortId, asset.name, asset.mimeType);
  const form = new FormData();
  Object.entries(signed.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);
  onProgress?.(12, 'Uploading video…');
  const response = await expoFetch(signed.upload_url, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await storageError(response, 'Storage rejected the video.'));
  onProgress?.(96, 'Upload complete…');
  return signed.s3_key;
}

async function uploadMultipart(
  api: CsgApi,
  file: File,
  asset: RecordingUploadAsset,
  cohortId: number,
  onProgress?: (percent: number, label: string) => void,
) {
  onProgress?.(2, 'Preparing large video…');
  const initiated = await api.initiateMultipartUpload(cohortId, asset.name, asset.mimeType, asset.size);
  const parts: { part_number: number; etag: string }[] = [];
  const totalParts = Math.ceil(asset.size / PART_SIZE);

  try {
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const start = index * PART_SIZE;
      const end = Math.min(start + PART_SIZE, asset.size);
      const part = file.slice(start, end, asset.mimeType);
      const etag = await uploadPartWithRetry(api, initiated.s3_key, initiated.upload_id, partNumber, part);
      parts.push({ part_number: partNumber, etag });
      onProgress?.(Math.max(3, Math.round((partNumber / totalParts) * 94)), `Uploading part ${partNumber} of ${totalParts}…`);
    }

    await api.completeMultipartUpload(initiated.s3_key, initiated.upload_id, parts);
    onProgress?.(97, 'Finalizing large video…');
    return initiated.s3_key;
  } catch (error) {
    await api.abortMultipartUpload(initiated.s3_key, initiated.upload_id).catch(() => undefined);
    throw error;
  }
}

async function uploadPartWithRetry(
  api: CsgApi,
  s3Key: string,
  uploadId: string,
  partNumber: number,
  part: Blob,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const signed = await api.multipartPartUrl(s3Key, uploadId, partNumber);
      const response = await expoFetch(signed.upload_url, { method: 'PUT', body: part });
      if (!response.ok) throw new Error(await storageError(response, `Part ${partNumber} was rejected.`));
      const etag = response.headers.get('etag');
      if (!etag) throw new Error('Storage did not return the ETag required to finish this upload.');
      return etag;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 700 * attempt * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Part ${partNumber} failed after ${MAX_ATTEMPTS} attempts.`);
}

async function storageError(response: Response, fallback: string) {
  const body = await response.text().catch(() => '');
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  return code ? `${fallback} (${code})` : `${fallback} (${response.status})`;
}
