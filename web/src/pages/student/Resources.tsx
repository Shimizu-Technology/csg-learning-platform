import { PausedLearningBanner, useSelectedCoursePaused } from '../../components/student/PausedLearningBanner'
import { PageHeader } from '../../components/ui/PageHeader'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Link2, Search, Video, MessageSquare, Github, FileText, Globe, RefreshCw, WifiOff, Keyboard, Copy, Check, FolderLock, NotebookPen, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useStudentExperience } from '../../lib/studentExperience'
import { useCohortContext } from '../../contexts/CohortContext'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { ResourceEntry } from '../../types/api'
import { downloadCourseResource } from '../../lib/downloadCourseResource'
import { STUDENT_FOLDER_PRESETS, matchesFileQuery, type CohortFile, type CohortFilesResponse } from '../../lib/cohortFiles'
import { CohortDocForm, CohortFileRow, CohortFileUploader, CohortLinkForm, FolderBadge } from '../../components/shared/CohortFileParts'
import { FolderZipButton } from '../../components/shared/FolderZipButton'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'

type ResourceItem = ResourceEntry

const categoryConfig: Record<string, { label: string; icon: typeof Globe }> = {
  meeting: { label: 'Meeting', icon: Video },
  github: { label: 'GitHub', icon: Github },
  communication: { label: 'Communication', icon: MessageSquare },
  documentation: { label: 'Docs', icon: FileText },
  hotkeys: { label: 'Hotkeys', icon: Keyboard },
  shortcuts: { label: 'Hotkeys', icon: Keyboard },
  general: { label: 'General', icon: Globe },
}

export function Resources() {
  const { v2 } = useStudentExperience()
  const { selectedCohortId } = useCohortContext()
  const paused = useSelectedCoursePaused(selectedCohortId)
  const pausedBanner = paused && <PausedLearningBanner cohortId={selectedCohortId} />
  const todayPath = v2 && selectedCohortId ? `/dashboard?cohort_id=${selectedCohortId}` : '/dashboard'
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  useEffect(() => { setQuery(searchParams.get('q') || '') }, [searchParams])
  const [copiedResourceId, setCopiedResourceId] = useState<number | string | null>(null)
  const resourcesRequest = useRef(0)
  const [cohortFiles, setCohortFiles] = useState<CohortFilesResponse | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const filesRequest = useRef(0)
  // The cohort on screen now; an upload that finishes after a switch must not land in the new cohort's list.
  const shownCohortId = useRef(selectedCohortId)
  useEffect(() => { shownCohortId.current = selectedCohortId }, [selectedCohortId])
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState<'link' | 'doc' | null>(null)
  // A notification link (?file=) or a new doc opens that item once.
  const linkedFileId = Number(searchParams.get('file')) || null
  const [openFileId, setOpenFileId] = useState<number | null>(linkedFileId)
  useEffect(() => { if (linkedFileId) setOpenFileId(linkedFileId) }, [linkedFileId])
  const clearOpenFile = useCallback(() => setOpenFileId(null), [])

  const loadCohortFiles = useCallback(() => {
    const request = ++filesRequest.current
    setCohortFiles(null)
    setFilesError(null)
    if (!selectedCohortId) return
    // Staff, and learners without read access (401/403), get no private folder here.
    void api.getCohortFiles(selectedCohortId).then((res) => {
      if (request !== filesRequest.current) return
      if (res.data?.my_files) setCohortFiles(res.data)
      else if (!res.data && res.status !== 401 && res.status !== 403) setFilesError(res.error || 'Could not load your files.')
    })
  }, [selectedCohortId])
  useEffect(() => { loadCohortFiles() }, [loadCohortFiles])
  const updateMyFiles = (update: (files: CohortFile[]) => CohortFile[]) =>
    setCohortFiles((current) => current && { ...current, my_files: update(current.my_files || []) })
  const addUploadedFile = (file: CohortFile) => {
    toast.success(file.kind === 'file' ? `Uploaded ${file.title}` : `Added ${file.title}`)
    if (file.cohort_id === shownCohortId.current) updateMyFiles((files) => [...files, file])
  }
  const updateMyFile = (file: CohortFile) => {
    if (file.cohort_id === shownCohortId.current) updateMyFiles((files) => files.map((item) => (item.id === file.id ? file : item)))
  }
  const replaceMyFile = (file: CohortFile) => {
    toast.success(`Uploaded version ${file.version_number} of ${file.title}`)
    if (file.cohort_id === shownCohortId.current) updateMyFiles((files) => files.map((item) => (item.id === file.id ? file : item)))
  }
  const removeMyFile = async (file: CohortFile) => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: 'It is removed from your private folder for you and your instructors.', confirmLabel: file.kind === 'link' ? 'Delete link' : file.kind === 'doc' ? 'Delete doc' : 'Delete file', tone: 'danger' })
    if (!ok || !selectedCohortId) return
    const result = await api.deleteCohortFile(selectedCohortId, file.id)
    if (result.error) return toast.error(result.error)
    updateMyFiles((files) => files.filter((item) => item.id !== file.id))
    toast.success(`Deleted ${file.title}`)
  }

  const loadResources = useCallback(() => {
    const request = ++resourcesRequest.current
    setLoading(true)
    setResources([])
    setLoadError(null)
    setShowingSavedData(false)

    api.getResources(selectedCohortId ?? undefined)
      .then((res) => {
        if (request !== resourcesRequest.current) return
        if (res.data?.resources) {
          setResources(res.data.resources)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
          return
        }

        setLoadError(res.error || 'Unable to load resources right now.')
      })
      .catch((error: unknown) => {
        if (request !== resourcesRequest.current) return
        setLoadError(error instanceof Error ? error.message : 'Unable to load resources right now.')
      })
      .finally(() => { if (request === resourcesRequest.current) setLoading(false) })
  }, [selectedCohortId])

  useEffect(() => {
    loadResources()
  }, [loadResources])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return resources
    return resources.filter((resource) =>
      resource.title.toLowerCase().includes(q) ||
      resource.url.toLowerCase().includes(q) ||
      resource.category.toLowerCase().includes(q) ||
      (resource.description || '').toLowerCase().includes(q)
    )
  }, [resources, query])

  const grouped = useMemo(() => {
    const hotkeys = filtered.filter((resource) => !resource.download_id && ['hotkeys', 'shortcuts'].includes(resource.category))
    const regular = filtered.filter((resource) => !resource.download_id && !['hotkeys', 'shortcuts'].includes(resource.category))
    const files = filtered.filter(resource => resource.download_id)
    return { hotkeys, regular, files }
  }, [filtered])

  const myFiles = useMemo(() => (cohortFiles?.my_files || []).filter((file) => matchesFileQuery(file, query)), [cohortFiles, query])
  const classFolders = useMemo(() => {
    const groups = new Map<string, CohortFile[]>()
    ;(cohortFiles?.class_files || []).filter((file) => matchesFileQuery(file, query)).forEach((file) => groups.set(file.folder, [...(groups.get(file.folder) || []), file]))
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [cohortFiles, query])
  const hasFolder = Boolean(cohortFiles)
  const fileCount = (cohortFiles?.my_files?.length || 0) + (cohortFiles?.class_files.length || 0)

  const copyResource = useCallback((resource: ResourceItem) => {
    if (!navigator.clipboard) return

    void navigator.clipboard.writeText(resource.url).then(() => {
      setCopiedResourceId(resource.id)
      window.setTimeout(() => setCopiedResourceId((current) => current === resource.id ? null : current), 1800)
    })
  }, [])

  if (loading) return <LoadingSpinner message="Loading resources..." />

  if (loadError && resources.length === 0) {
    return (
      <div className="app-page max-w-5xl"><EmptyState headingLevel={1}
        icon={WifiOff}
        title="Could not load resources"
        description={loadError}
        action={
          <Button onClick={loadResources}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        }
      /></div>
    )
  }

  // A private folder (with files, or room to upload) is never a "No resources yet" dead end.
  if (resources.length === 0 && fileCount === 0 && !cohortFiles?.can_upload_personal && !filesError) {
    return (
      <div className="app-page max-w-5xl">{pausedBanner}<EmptyState headingLevel={1}
        icon={Link2}
        title={paused ? 'No resources available before your pause' : 'No resources yet'}
        description={paused ? 'Resources published before you paused appear here.' : 'Class resources will appear here once your instructor adds them.'}
        action={<Link to={todayPath} className="app-link inline-flex min-h-11 items-center gap-1"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Today</Link>}
      /></div>
    )
  }

  const Header = v2 ? 'div' : 'header'
  return (
    <div className="app-page max-w-5xl">
      {pausedBanner}
      {showingSavedData && (
        <div className="rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          Showing saved resources while your connection catches up.
        </div>
      )}
      <Header>
        <Link to={todayPath} className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-line/70">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Today
        </Link>
        {v2 ? <PageHeader eyebrow="Your class library" title="Resources" description="Important links, references, and shortcuts collected for your cohort." /> : <>
        <p className="app-eyebrow">Your class library</p>
        <h1 className="app-title mt-2">Resources</h1>
        <p className="app-description mt-2">Important links, references, and shortcuts collected for your cohort.</p>
        </>}
      </Header>

      {(resources.length + fileCount > 4 || query.length > 0) && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources..."
            aria-label="Search resources"
            className="app-control w-full pl-10"
          />
        </div>
      )}

      {filesError && selectedCohortId && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink sm:flex-row sm:items-center sm:justify-between">
          <p>Your files and class files could not load. {filesError}</p>
          <Button size="sm" variant="secondary" onClick={loadCohortFiles}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {hasFolder && selectedCohortId && (
        <section className="space-y-3" aria-label="My files">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><FolderLock className="h-5 w-5 text-ink-muted" aria-hidden="true" />My files</h2>
              <p className="text-sm text-ink-muted">Your private folder — only you and your instructors can see files here.</p>
            </div>
            {(cohortFiles?.my_files?.length || 0) > 0 && (
              <FolderZipButton cohortId={selectedCohortId} scope="my_files" empty={false} label="Download all as ZIP" className="sm:shrink-0"
                ariaLabel="Download all my files as a ZIP" />
            )}
          </div>
          <CohortFileUploader key={selectedCohortId} cohortId={selectedCohortId} heading="Upload files" folderPresets={STUDENT_FOLDER_PRESETS}
            description="Resumes, cover letters, workbooks and notes. Choose several at once, up to 100 MB each."
            disabled={!cohortFiles?.can_upload_personal || !cohortFiles?.storage_configured}
            disabledReason={!cohortFiles?.can_upload_personal ? 'Uploads are paused while your course is paused or your access has ended. You can still download your files.' : "File uploads aren't available right now. You can still add links."}
            onUploaded={addUploadedFile} />
          {cohortFiles?.can_upload_personal && (adding === 'link' ? (
            <CohortLinkForm key={`link-${selectedCohortId}`} cohortId={selectedCohortId} heading="Add a link to my files" folderPresets={STUDENT_FOLDER_PRESETS}
              onCancel={() => setAdding(null)}
              onSaved={(file) => { addUploadedFile(file); setAdding(null) }} />
          ) : adding === 'doc' ? (
            <CohortDocForm key={`doc-${selectedCohortId}`} cohortId={selectedCohortId} heading="New doc in my files" folderPresets={STUDENT_FOLDER_PRESETS}
              description="Write notes, a plan or a checklist right here. It saves as you type, and your instructors can review it."
              onCancel={() => setAdding(null)}
              onCreated={(file) => { addUploadedFile(file); setAdding(null); setOpenFileId(file.id) }} />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="secondary" onClick={() => setAdding('link')}>
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Add a link
              </Button>
              <Button variant="secondary" onClick={() => setAdding('doc')}>
                <NotebookPen className="h-4 w-4" aria-hidden="true" />
                New doc
              </Button>
            </div>
          ))}
          {myFiles.length > 0 ? (
            <ul className="app-surface divide-y divide-line overflow-hidden" aria-label="Files in my folder">
              {myFiles.map((file) => (
                <CohortFileRow key={file.id} cohortId={selectedCohortId} file={file} badges={<FolderBadge folder={file.folder} />} downloadDisabled={!cohortFiles?.storage_configured}
                  canUploadVersion={Boolean(file.can_manage && file.kind === 'file' && cohortFiles?.can_upload_personal && cohortFiles?.storage_configured)} onVersionUploaded={replaceMyFile}
                  review={{ staff: false, canChange: Boolean(cohortFiles?.can_upload_personal) }} onFileChange={updateMyFile} autoOpen={file.id === openFileId} onAutoOpened={clearOpenFile}
                  note={file.uploaded_by_role === 'student' ? 'Added by you' : 'Shared by your instructor'}
                  actions={file.can_manage ? (
                    <Button size="sm" variant="quiet" onClick={() => void removeMyFile(file)} aria-label={`Delete ${file.title}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : undefined} />
              ))}
            </ul>
          ) : <p className="text-sm text-ink-muted">{query ? 'No files in your folder match this search.' : 'No files in your folder yet.'}</p>}
        </section>
      )}

      {hasFolder && selectedCohortId && (
        <section className="space-y-3" aria-label="Class files">
          <div>
            <h2 className="text-lg font-bold text-ink">Class files</h2>
            <p className="text-sm text-ink-muted">Slides, guides and templates your instructors shared with your cohort.</p>
          </div>
          {classFolders.map(([folder, files]) => (
            <div key={folder} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-secondary">{folder}</h3>
              <ul className="app-surface divide-y divide-line overflow-hidden" aria-label={`${folder} files`}>
                {files.map((file) => <CohortFileRow key={file.id} cohortId={selectedCohortId} file={file} downloadDisabled={!cohortFiles?.storage_configured} autoOpen={file.id === openFileId} onAutoOpened={clearOpenFile} />)}
              </ul>
            </div>
          ))}
          {!classFolders.length && <p className="text-sm text-ink-muted">{query ? 'No class files match this search.' : 'No class files yet.'}</p>}
        </section>
      )}

      <section className="space-y-3" aria-label="Cohort links">
        <h2 className="text-lg font-bold text-ink">Cohort links</h2>
        <p className="text-sm text-ink-muted">Links and references shared specifically with your cohort.</p>
      {grouped.hotkeys.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface-sunken p-4">
          <div className="mb-3 flex items-center gap-2">
            <Keyboard className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-ink">Hotkeys and shortcuts</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {grouped.hotkeys.map((resource) => (
              <HotkeyCard
                key={resource.id}
                resource={resource}
                copied={copiedResourceId === resource.id}
                onCopy={() => copyResource(resource)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {grouped.regular.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} />
        ))}
      </div>
      </section>
      <section className="space-y-3" aria-label="Course files">
        <h2 className="text-lg font-bold text-ink">Course files</h2>
        <p className="text-sm text-ink-muted">Downloadable files shared across cohorts using this curriculum.</p>
        {grouped.files.map(resource => <ResourceCard key={resource.id} resource={resource} />)}
        {!grouped.files.length && <p className="text-sm text-ink-muted">No course files match this view.</p>}
      </section>
    </div>
  )
}

function HotkeyCard({
  resource,
  copied,
  onCopy,
}: {
  resource: ResourceItem
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="app-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2>
          </div>
          {resource.description && (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{resource.description}</p>
          )}
          <p className="mt-2 break-all text-xs text-ink-muted">{resource.url}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Copy shortcut link" onClick={onCopy}>
            {copied ? <Check className="h-4 w-4 text-success-ink" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </IconButton>
          <a
            href={sanitizeUrl(resource.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-line/70"
            aria-label="Open shortcut resource"
            title="Open shortcut resource"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  )
}

function ResourceCard({ resource, compact = false }: { resource: ResourceItem; compact?: boolean }) {
          const [downloading, setDownloading] = useState(false)
          const [error, setError] = useState('')
          const download = async () => {
            if (!resource.download_id || !resource.curriculum_id || downloading) return
            setDownloading(true); setError('')
            try {
              await downloadCourseResource(resource.curriculum_id, resource.download_id, resource.filename || 'course-resources.zip')
            } catch (cause) { setError(cause instanceof Error ? cause.message : 'Download failed.') }
            finally { setDownloading(false) }
          }
          if (resource.download_id) return <div className="app-surface p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h2 className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2><p className="mt-1 break-all text-sm text-ink-secondary">{resource.filename}</p></div>
              <Button variant="secondary" disabled={downloading} onClick={() => void download()}>{downloading ? 'Preparing download…' : 'Download ZIP'}</Button></div>
            {error && <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p>}
          </div>
          const cat = categoryConfig[resource.category] || categoryConfig.general
          const Icon = cat.icon
          return (
            <a
              href={sanitizeUrl(resource.url)}
              target="_blank"
              rel="noopener noreferrer"
      className={`pressable block rounded-2xl border border-line bg-surface-raised shadow-raised ${compact ? 'p-4' : 'p-5'} hover:border-line-strong hover:bg-surface-sunken`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2>
                      <Badge>{cat.label}</Badge>
                    </div>
                    {resource.description && (
                      <p className="mt-1 text-sm text-ink-secondary">{resource.description}</p>
                    )}
                    <p className="mt-1 break-all text-xs text-ink-muted">{resource.url}</p>
                  </div>
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </div>
            </a>
          )
}
