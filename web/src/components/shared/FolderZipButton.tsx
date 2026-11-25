import { useState } from 'react'
import { FileArchive, Loader2 } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import { downloadCohortFolderZip } from '../../lib/cohortFiles'
import { Button, type ButtonSize, type ButtonVariant } from '../ui/Button'

/**
 * Downloads a folder as one ZIP with the signed-in session: a learner's own
 * folder, the class files, or one student's folder. Disabled while the
 * archive downloads and when there is nothing in it.
 */
export function FolderZipButton({ cohortId, scope, studentId, folder, empty, label = 'Download ZIP', ariaLabel, variant = 'secondary', size = 'md', className = '' }: {
  cohortId: number
  scope: 'my_files' | 'class' | 'student'
  studentId?: number
  folder?: string
  /** Nothing to download yet. */
  empty: boolean
  label?: string
  ariaLabel?: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}) {
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadCohortFolderZip(cohortId, { scope, studentId, folder })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not download these files.')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <Button variant={variant} size={size} className={className} disabled={empty || downloading} aria-label={ariaLabel} aria-busy={downloading || undefined} onClick={() => void download()}>
      {downloading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileArchive className="h-4 w-4" aria-hidden="true" />}
      {downloading ? 'Preparing ZIP…' : label}
    </Button>
  )
}
