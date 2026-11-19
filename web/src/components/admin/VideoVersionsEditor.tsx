import { useRef, useState } from 'react'
import { useUpload } from '../../contexts/UploadContext'
import { videoVersions, type VideoVersion } from '../../lib/videoVersions'
import { isSupportedVideoFile, VIDEO_FILE_ACCEPT } from '../../lib/videoUploadValidation'
import { Button } from '../ui/Button'

export function VideoVersionsEditor({ metadata, sourceKey, onChange }: {
  metadata: Record<string, unknown>; sourceKey: string; onChange: (metadata: Record<string, unknown>) => void
}) {
  const { startVideoUpload } = useUpload()
  const versions = videoVersions(metadata)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef({ metadata, onChange })
  latest.current = { metadata, onChange }
  const save = (next: VideoVersion[]) => onChange({ ...metadata, video_versions: next })
  const upload = async (file: File) => {
    if (!isSupportedVideoFile(file) || file.size > 5 * 1024 ** 3) { setError('Choose a video smaller than 5 GB.'); return }
    setUploading(true)
    setError('')
    const { result } = startVideoUpload(file, { deferPersistence: true })
    const uploaded = await result
    setUploading(false)
    if (!uploaded) { setError('Upload failed. Please try again.'); return }
    const current = latest.current
    const items = videoVersions(current.metadata)
    current.onChange({ ...current.metadata, video_versions: [
      ...(items.length ? items : [{ id: crypto.randomUUID(), label: 'Original', s3_video_key: sourceKey }]),
      { id: crypto.randomUUID(), label: 'Alternate', s3_video_key: uploaded.s3Key },
    ] })
  }
  return <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3">
    <legend className="px-1 text-sm font-semibold">Video versions</legend>
    <p className="text-sm text-ink-secondary">The first version plays by default. All versions share this block’s watch progress. Removing every version restores the original upload.</p>
    {versions.map((version, index) => <div key={version.id} className="flex flex-wrap items-center gap-2">
      <label className="min-w-0 basis-full text-sm">Version {index + 1}{index === 0 ? ' (default)' : ''}
        <input className="app-control mt-1 w-full" maxLength={40} value={version.label} onChange={(e) => save(versions.map((v) => v.id === version.id ? { ...v, label: e.target.value } : v))} />
      </label>
      <Button variant="secondary" disabled={uploading || index === 0} aria-label={`Move ${version.label} up`} onClick={() => { const next = [...versions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; save(next) }}>Up</Button>
      <Button variant="secondary" disabled={uploading || index === versions.length - 1} aria-label={`Move ${version.label} down`} onClick={() => { const next = [...versions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; save(next) }}>Down</Button>
      <Button variant="secondary" disabled={uploading} aria-label={`Remove ${version.label}`} onClick={() => save(versions.filter((v) => v.id !== version.id))}>Remove</Button>
    </div>)}
    <label className="block min-h-11 cursor-pointer space-y-2 text-sm font-semibold">{uploading ? 'Uploading version…' : 'Add video version'}
      <input aria-label="Upload video version" className="block min-w-0 w-full max-w-full" type="file" accept={VIDEO_FILE_ACCEPT} disabled={uploading || versions.length >= 8} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} />
    </label>
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
  </fieldset>
}
