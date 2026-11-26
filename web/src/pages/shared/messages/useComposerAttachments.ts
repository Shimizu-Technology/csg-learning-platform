import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../../../lib/api';
import { composerDestinationKey, type UploadedMessageAttachment } from '../../../lib/messageComposerState';
import { uploadToS3 } from '../../../lib/uploadToS3';
import type { PendingAttachment, Target } from './types';

/**
 * Files waiting in the composer, kept per draft (conversation and thread), their
 * uploads, and the local preview URLs of optimistic sends.
 */
export function useComposerAttachments(userId: number | undefined, selectedTarget: Target | null, activeThreadRootId: number | null) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentBucketKeyRef = useRef<string | null>(null)
  const pendingAttachmentBucketsRef = useRef(new Map<string, PendingAttachment[]>())
  const pendingAttachmentsRef = useRef(pendingAttachments)
  const pendingPreviewUrlsRef = useRef(new Set<string>())
  const optimisticAttachmentUrls = useRef(new Map<number, string[]>())
  pendingAttachmentsRef.current = pendingAttachments

  const revokePendingPreviews = (items: PendingAttachment[]) => {
    items.forEach((item) => {
      if (!item.previewUrl) return
      URL.revokeObjectURL(item.previewUrl)
      pendingPreviewUrlsRef.current.delete(item.previewUrl)
    })
  }

  const composerDraftKey = userId && selectedTarget ? composerDestinationKey(userId, selectedTarget, activeThreadRootId) : null

  // Pending attachments belong to a draft: switching conversations keeps each one's files.
  useEffect(() => {
    const previous = attachmentBucketKeyRef.current
    if (previous === composerDraftKey) return
    if (previous) pendingAttachmentBucketsRef.current.set(previous, pendingAttachmentsRef.current)
    attachmentBucketKeyRef.current = composerDraftKey
    setPendingAttachments(composerDraftKey ? pendingAttachmentBucketsRef.current.get(composerDraftKey) || [] : [])
  }, [composerDraftKey])

  useEffect(() => () => {
    optimisticAttachmentUrls.current.forEach((urls) => urls.forEach((url) => URL.revokeObjectURL(url)))
    optimisticAttachmentUrls.current.clear()
    pendingPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    pendingPreviewUrlsRef.current.clear()
  }, [])

  /** The submitted files went out with a message: empty the composer and forget that draft's files. */
  const clearSubmittedAttachments = (draftKey: string | null) => {
    revokePendingPreviews(pendingAttachmentsRef.current)
    setPendingAttachments([])
    if (draftKey) {
      const bucket = pendingAttachmentBucketsRef.current.get(draftKey)
      if (bucket) revokePendingPreviews(bucket)
      pendingAttachmentBucketsRef.current.delete(draftKey)
    }
  }

  const rememberOptimisticAttachmentUrls = (messageId: number, urls: string[]) => {
    if (urls.length > 0) optimisticAttachmentUrls.current.set(messageId, urls)
  }

  const releaseOptimisticAttachmentUrls = (messageId: number) => {
    const urls = optimisticAttachmentUrls.current.get(messageId)
    if (!urls) return

    urls.forEach((url) => URL.revokeObjectURL(url))
    optimisticAttachmentUrls.current.delete(messageId)
  }

  const uploadAttachments = async (attachmentsToUpload: PendingAttachment[], target: Target | null): Promise<UploadedMessageAttachment[]> => {
    if (!target) return []

    const uploaded = []
    for (const attachment of attachmentsToUpload) {
      if (attachment.uploaded && attachment.s3_key) {
        uploaded.push({
          s3_key: attachment.s3_key,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size,
        })
        continue
      }

      const presign = await api.presignMessageAttachment({
        channel_id: target.type === 'channel' ? target.id : undefined,
        direct_conversation_id: target.type === 'dm' ? target.id : undefined,
        filename: attachment.filename,
        content_type: attachment.content_type,
      })
      if (!presign.data) throw new Error(presign.error || 'Could not prepare upload.')

      await uploadToS3(presign.data.upload_url, presign.data.fields, attachment.file, (progress) => {
        setPendingAttachments((prev) => prev.map((item) => item.file === attachment.file ? { ...item, progress: progress.percent } : item))
      })

      uploaded.push({
        s3_key: presign.data.s3_key,
        filename: attachment.filename,
        content_type: attachment.content_type,
        byte_size: attachment.byte_size,
      })
    }
    return uploaded
  }

  const addFiles = (files: File[]) => {
    const next = files.map((file) => {
      const contentType = file.type || 'application/octet-stream'
      let previewUrl: string | undefined
      if (contentType.startsWith('image/') && typeof URL.createObjectURL === 'function') {
        previewUrl = URL.createObjectURL(file)
        pendingPreviewUrlsRef.current.add(previewUrl)
      }
      return {
        file,
        filename: file.name,
        content_type: contentType,
        byte_size: file.size,
        progress: 0,
        uploaded: false,
        previewUrl,
      }
    })
    setPendingAttachments((prev) => [...prev, ...next])
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    addFiles(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    // Rich mode's editor already took the files (and prevented the default); don't add them twice.
    if (event.defaultPrevented) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    event.preventDefault()
    addFiles(files)
  }

  const removePendingAttachment = (file: File) => {
    setPendingAttachments((prev) => {
      const removed = prev.filter((item) => item.file === file)
      revokePendingPreviews(removed)
      return prev.filter((item) => item.file !== file)
    })
  }

  return {
    pendingAttachments,
    composerDraftKey,
    fileInputRef,
    clearSubmittedAttachments,
    rememberOptimisticAttachmentUrls,
    releaseOptimisticAttachmentUrls,
    uploadAttachments,
    addFiles,
    handleFiles,
    handleDrop,
    removePendingAttachment,
  }
}

export type ComposerAttachments = ReturnType<typeof useComposerAttachments>
