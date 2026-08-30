interface VideoUploadWarningProps {
  message: string | null | undefined
}

export function VideoUploadWarning({ message }: VideoUploadWarningProps) {
  if (!message) return null

  return <p className="text-xs text-amber-700">{message}</p>
}
