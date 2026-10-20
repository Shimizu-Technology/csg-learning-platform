interface VideoUploadWarningProps {
  message: string | null | undefined
}

export function VideoUploadWarning({ message }: VideoUploadWarningProps) {
  if (!message) return null

  return <p role="status" className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">{message}</p>
}
