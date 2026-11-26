import { useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '../../../types/api';

/** The full-screen image viewer: which images, which one, keyboard and swipe paging, download. */
export function useAttachmentLightbox() {
  const [lightboxAttachments, setLightboxAttachments] = useState<MessageAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const lightboxTouchStartX = useRef<number | null>(null)
  const lightboxAttachment = lightboxAttachments[lightboxIndex] || null

  useEffect(() => {
    if (!lightboxAttachment) return

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLightboxAttachments([])
        setLightboxIndex(0)
        return
      }
      if (event.key === 'ArrowRight') {
        setLightboxIndex((current) => Math.min(current + 1, lightboxAttachments.length - 1))
        return
      }
      if (event.key === 'ArrowLeft') {
        setLightboxIndex((current) => Math.max(current - 1, 0))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxAttachment, lightboxAttachments.length])

  const openLightbox = (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => {
    setLightboxAttachments(imageAttachments)
    setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
  }

  const showPreviousLightboxImage = () => {
    setLightboxIndex((current) => Math.max(current - 1, 0))
  }

  const showNextLightboxImage = () => {
    setLightboxIndex((current) => Math.min(current + 1, lightboxAttachments.length - 1))
  }

  const closeLightbox = () => {
    setLightboxAttachments([])
    setLightboxIndex(0)
  }

  const downloadLightboxAttachment = async () => {
    if (!lightboxAttachment?.url) return

    try {
      const response = await fetch(lightboxAttachment.url)
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = lightboxAttachment.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(lightboxAttachment.url, '_blank', 'noopener,noreferrer')
    }
  }

  return {
    lightboxAttachments,
    lightboxIndex,
    lightboxAttachment,
    lightboxTouchStartX,
    openLightbox,
    showPreviousLightboxImage,
    showNextLightboxImage,
    closeLightbox,
    downloadLightboxAttachment,
  }
}

export type AttachmentLightbox = ReturnType<typeof useAttachmentLightbox>
