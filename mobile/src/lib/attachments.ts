import type { CsgApi } from './api';
import type { PendingAttachment, UploadAttachmentInput } from './types';

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

export type LocalAttachmentAsset = {
  uri: string;
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
};

export function validateAttachment(asset: LocalAttachmentAsset) {
  const filename = asset.name?.trim() || 'attachment';
  const contentType = asset.mimeType?.toLowerCase().trim() || '';
  const byteSize = asset.size || 0;

  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
    throw new Error(`${filename} is not a supported file type.`);
  }
  if (byteSize <= 0) {
    throw new Error(`We could not determine the size of ${filename}.`);
  }
  if (byteSize > MAX_ATTACHMENT_SIZE) {
    throw new Error(`${filename} is larger than the 25 MB limit.`);
  }

  return { filename, contentType, byteSize };
}

export function pendingAttachment(asset: LocalAttachmentAsset): PendingAttachment {
  const { filename, contentType, byteSize } = validateAttachment(asset);
  return {
    local_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    uri: asset.uri,
    filename,
    content_type: contentType,
    byte_size: byteSize,
    image: contentType.startsWith('image/'),
    status: 'queued',
    progress: 0,
  };
}

export async function uploadAttachment(
  api: CsgApi,
  kind: 'channel' | 'dm',
  conversationId: number,
  attachment: PendingAttachment,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<UploadAttachmentInput> {
  if (attachment.uploaded) return attachment.uploaded;

  const presign = await api.presignAttachment(
    kind,
    conversationId,
    attachment.filename,
    attachment.content_type,
  );

  if (attachment.byte_size > presign.max_size) {
    throw new Error(`${attachment.filename} is larger than the server upload limit.`);
  }

  await postPresignedForm({
    url: presign.upload_url,
    fields: presign.fields,
    attachment,
    onProgress,
    signal,
  });

  return {
    s3_key: presign.s3_key,
    filename: attachment.filename,
    content_type: attachment.content_type,
    byte_size: attachment.byte_size,
  };
}

function postPresignedForm({
  url,
  fields,
  attachment,
  onProgress,
  signal,
}: {
  url: string;
  fields: Record<string, string>;
  attachment: PendingAttachment;
  onProgress: (progress: number) => void;
  signal?: AbortSignal;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });

    request.open('POST', url);
    request.timeout = 90_000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    request.onerror = () => reject(new Error(`Could not upload ${attachment.filename}. Check your connection and try again.`));
    request.ontimeout = () => reject(new Error(`${attachment.filename} took too long to upload.`));
    request.onabort = () => reject(new Error(`${attachment.filename} upload was cancelled.`));
    request.onload = () => {
      signal?.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`Could not upload ${attachment.filename} (${request.status}).`));
      }
    };

    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', {
      uri: attachment.uri,
      name: attachment.filename,
      type: attachment.content_type,
    } as unknown as Blob);
    request.send(form);
  });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
