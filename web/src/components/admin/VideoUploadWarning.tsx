interface VideoUploadWarningProps {
  message: string | null | undefined
}

export function VideoUploadWarning({ message }: VideoUploadWarningProps) {
  if (!message) return null

  return <p role="status" className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning-ink">{message}</p>
}
