import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Video,
  FileText,
  Code,
  CheckCircle2,
  Play,
  Edit2,
  Plus,
  Save,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  solution: string | null
  metadata: Record<string, unknown>
}

interface Lesson {
  id: number
  title: string
  module_id: number
  lesson_type?: string
  content_blocks: ContentBlock[]
}

interface BlockFormData {
  title: string
  body: string
  video_url: string
  solution: string
  filename: string
  language: string
}

const BLOCK_TYPES = ['video', 'text', 'exercise', 'code_challenge', 'checkpoint', 'recording'] as const
const LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto-detect (from filename)' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'shell', label: 'Shell / Bash' },
] as const

type BlockType = (typeof BLOCK_TYPES)[number]

const blockTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  exercise: <Code className="h-4 w-4" />,
  code_challenge: <Code className="h-4 w-4" />,
  checkpoint: <CheckCircle2 className="h-4 w-4" />,
  recording: <Play className="h-4 w-4" />,
}

function hasVideoUrl(blockType: string): boolean {
  return blockType === 'video' || blockType === 'recording'
}

function hasSolutionOrFilename(blockType: string): boolean {
  return blockType === 'exercise' || blockType === 'code_challenge'
}

function getLanguageFromBlock(block: ContentBlock): string {
  const lang = block.metadata?.language
  return typeof lang === 'string' ? lang : ''
}

function emptyFormData(): BlockFormData {
  return { title: '', body: '', video_url: '', solution: '', filename: '', language: '' }
}

function blockToFormData(block: ContentBlock): BlockFormData {
  return {
    title: block.title ?? '',
    body: block.body ?? '',
    video_url: block.video_url ?? '',
    solution: block.solution ?? '',
    filename: block.filename ?? '',
    language: getLanguageFromBlock(block),
  }
}

interface EditBlockRowProps {
  block: ContentBlock
  isFirst: boolean
  isLast: boolean
  reordering: boolean
  onSaved: (updated: ContentBlock) => void
  onDeleted: (id: number) => void
  onMove: (direction: 'up' | 'down') => void
}

function EditBlockRow({ block, isFirst, isLast, reordering, onSaved, onDeleted, onMove }: EditBlockRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<BlockFormData>(blockToFormData(block))
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const metadata: Record<string, unknown> = { ...(block.metadata ?? {}) }
      if (form.language) {
        metadata.language = form.language
      } else {
        delete metadata.language
      }

      const payload: Record<string, string | null | Record<string, unknown>> = {
        title: form.title || null,
        body: form.body || null,
        metadata,
      }

      if (hasVideoUrl(block.block_type)) {
        payload.video_url = form.video_url || null
      }
      if (hasSolutionOrFilename(block.block_type)) {
        payload.solution = form.solution || null
        payload.filename = form.filename || null
      }

      const res = await api.updateContentBlock(block.id, payload)
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        const data = res.data as { content_block: ContentBlock }
        onSaved(data.content_block)
        setExpanded(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await api.deleteContentBlock(block.id)
      if (res.error) {
        setDeleteError(res.error)
        setDeleting(false)
      } else {
        onDeleted(block.id)
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        {/* Reorder buttons */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            onClick={() => onMove('up')}
            disabled={isFirst || reordering}
            className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove('down')}
            disabled={isLast || reordering}
            className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="text-slate-400">{blockTypeIcons[block.block_type] ?? <FileText className="h-4 w-4" />}</span>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {block.block_type.replace('_', ' ')}
        </span>
        <span className="text-sm text-slate-700 flex-1 truncate">{block.title || <em className="text-slate-400">Untitled</em>}</span>
        <span className="text-xs text-slate-400 mr-2">#{block.position}</span>
        <button
          onClick={() => {
            setExpanded((v) => {
              if (v) {
                setForm(blockToFormData(block))
                setError(null)
              }
              return !v
            })
            setConfirmingDelete(false)
            setDeleteError(null)
          }}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => {
            setConfirmingDelete(true)
            setExpanded(false)
            setDeleteError(null)
          }}
          disabled={deleting}
          className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 disabled:opacity-50 ml-1"
          title="Delete block"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {confirmingDelete && (
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700 flex-1">
              Delete block &quot;{block.title || block.block_type}&quot;? This cannot be undone.
            </p>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={() => { setConfirmingDelete(false); setDeleteError(null) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
          {deleteError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</p>
          )}
        </div>
      )}

      {expanded && (
        <div className="p-4 space-y-3">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Block title"
            />
          </div>

          {hasVideoUrl(block.block_type) && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Video URL</label>
              <input
                type="text"
                value={form.video_url}
                onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
                placeholder="https://vimeo.com/... or https://youtube.com/..."
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Body</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y font-mono"
              placeholder="Markdown body content..."
            />
          </div>

          {hasSolutionOrFilename(block.block_type) && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Filename</label>
                  <input
                    type="text"
                    value={form.filename}
                    onChange={(e) => setForm((f) => ({ ...f, filename: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
                    placeholder="e.g. exercise.rb"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Language</label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Solution</label>
                <textarea
                  value={form.solution}
                  onChange={(e) => setForm((f) => ({ ...f, solution: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y font-mono"
                  placeholder="Staff-only solution..."
                />
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface AddBlockFormProps {
  lessonId: number
  nextPosition: number
  onAdded: (block: ContentBlock) => void
}

function AddBlockForm({ lessonId, nextPosition, onAdded }: AddBlockFormProps) {
  const [open, setOpen] = useState(false)
  const [blockType, setBlockType] = useState<BlockType>('video')
  const [form, setForm] = useState<BlockFormData>(emptyFormData())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setBlockType('video')
    setForm(emptyFormData())
    setError(null)
  }

  const handleAdd = async () => {
    setSaving(true)
    setError(null)

    try {
      const payload: Record<string, string | number | Record<string, unknown>> = {
        block_type: blockType,
        position: nextPosition,
        title: form.title,
      }

      if (form.body) payload.body = form.body
      if (hasVideoUrl(blockType) && form.video_url) payload.video_url = form.video_url
      if (hasSolutionOrFilename(blockType)) {
        if (form.solution) payload.solution = form.solution
        if (form.filename) payload.filename = form.filename
        if (form.language) payload.metadata = { language: form.language }
      }

      const res = await api.createContentBlock(lessonId, payload)
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        const data = res.data as { content_block: ContentBlock }
        onAdded(data.content_block)
        resetForm()
        setOpen(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-3 text-sm font-medium text-slate-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Block
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-primary-200 bg-primary-50 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">Add New Block</h3>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Block Type</label>
        <select
          value={blockType}
          onChange={(e) => setBlockType(e.target.value as BlockType)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {BLOCK_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Block title"
        />
      </div>

      {hasVideoUrl(blockType) && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Video URL</label>
          <input
            type="text"
            value={form.video_url}
            onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
            placeholder="https://vimeo.com/... or https://youtube.com/..."
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Body</label>
        <textarea
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
          placeholder="Markdown body content..."
        />
      </div>

      {hasSolutionOrFilename(blockType) && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Filename</label>
              <input
                type="text"
                value={form.filename}
                onChange={(e) => setForm((f) => ({ ...f, filename: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                placeholder="e.g. exercise.rb"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Language</label>
              <select
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Solution</label>
            <textarea
              value={form.solution}
              onChange={(e) => setForm((f) => ({ ...f, solution: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
              placeholder="Staff-only solution..."
            />
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            resetForm()
            setOpen(false)
          }}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {saving ? 'Adding...' : 'Add Block'}
        </button>
      </div>
    </div>
  )
}

export function LessonEditor() {
  const { id } = useParams<{ id: string }>()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reorderingBlockId, setReorderingBlockId] = useState<number | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.getLesson(Number(id)).then((res) => {
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        const data = res.data as { lesson: Lesson }
        setLesson(data.lesson)
      }
      setLoading(false)
    })
  }, [id])

  const handleBlockSaved = (updated: ContentBlock) => {
    setLesson((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        content_blocks: prev.content_blocks.map((b) => (b.id === updated.id ? updated : b)),
      }
    })
  }

  const handleBlockDeleted = (deletedId: number) => {
    setLesson((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        content_blocks: prev.content_blocks.filter((b) => b.id !== deletedId),
      }
    })
  }

  const handleBlockAdded = (newBlock: ContentBlock) => {
    setLesson((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        content_blocks: [...prev.content_blocks, newBlock],
      }
    })
  }

  const handleMoveBlock = async (block: ContentBlock, direction: 'up' | 'down') => {
    if (!lesson) return
    const sorted = [...lesson.content_blocks].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex((b) => b.id === block.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const swapBlock = sorted[swapIdx]
    setReorderingBlockId(block.id)
    setReorderError(null)

    try {
      // Sequential PATCHes to avoid race conditions
      const res1 = await api.updateContentBlock(block.id, { position: swapBlock.position })
      if (res1.error) {
        setReorderError(res1.error)
        setReorderingBlockId(null)
        return
      }
      const res2 = await api.updateContentBlock(swapBlock.id, { position: block.position })
      if (res2.error) {
        // Try to roll back the first update
        await api.updateContentBlock(block.id, { position: block.position })
        setReorderError(res2.error)
        setReorderingBlockId(null)
        return
      }

      // Optimistically update local state
      setLesson((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          content_blocks: prev.content_blocks.map((b) => {
            if (b.id === block.id) return { ...b, position: swapBlock.position }
            if (b.id === swapBlock.id) return { ...b, position: block.position }
            return b
          }),
        }
      })
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : 'Reorder failed')
    } finally {
      setReorderingBlockId(null)
    }
  }

  if (loading) return <LoadingSpinner message="Loading lesson..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/admin/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!lesson) return null

  const sortedBlocks = [...lesson.content_blocks].sort((a, b) => a.position - b.position)
  const nextPosition =
    lesson.content_blocks.length > 0
      ? Math.max(...lesson.content_blocks.map((b) => b.position)) + 1
      : 1

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{lesson.title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {lesson.content_blocks.length} content block{lesson.content_blocks.length !== 1 ? 's' : ''}
          {lesson.lesson_type && <> · <span className="capitalize">{lesson.lesson_type.replace('_', ' ')}</span></>}
        </p>
      </div>

      {reorderError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{reorderError}</p>
      )}

      <div className="space-y-3">
        {sortedBlocks.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-slate-400 text-sm">
            No content blocks yet. Add one below.
          </div>
        )}

        {sortedBlocks.map((block, idx) => (
          <EditBlockRow
            key={block.id}
            block={block}
            isFirst={idx === 0}
            isLast={idx === sortedBlocks.length - 1}
            reordering={reorderingBlockId === block.id}
            onSaved={handleBlockSaved}
            onDeleted={handleBlockDeleted}
            onMove={(direction) => handleMoveBlock(block, direction)}
          />
        ))}

        <AddBlockForm
          lessonId={lesson.id}
          nextPosition={nextPosition}
          onAdded={handleBlockAdded}
        />
      </div>
    </div>
  )
}
