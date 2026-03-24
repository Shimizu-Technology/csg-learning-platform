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
  content_blocks: ContentBlock[]
}

interface BlockFormData {
  title: string
  body: string
  video_url: string
  solution: string
  filename: string
}

const BLOCK_TYPES = ['video', 'text', 'exercise', 'code_challenge', 'checkpoint', 'recording'] as const
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

function emptyFormData(): BlockFormData {
  return { title: '', body: '', video_url: '', solution: '', filename: '' }
}

function blockToFormData(block: ContentBlock): BlockFormData {
  return {
    title: block.title ?? '',
    body: block.body ?? '',
    video_url: block.video_url ?? '',
    solution: block.solution ?? '',
    filename: block.filename ?? '',
  }
}

interface EditBlockRowProps {
  block: ContentBlock
  onSaved: (updated: ContentBlock) => void
  onDeleted: (id: number) => void
}

function EditBlockRow({ block, onSaved, onDeleted }: EditBlockRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<BlockFormData>(blockToFormData(block))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const payload: Record<string, string> = { title: form.title }
    if (form.body) payload.body = form.body
    if (hasVideoUrl(block.block_type) && form.video_url) payload.video_url = form.video_url
    if (hasSolutionOrFilename(block.block_type)) {
      if (form.solution) payload.solution = form.solution
      if (form.filename) payload.filename = form.filename
    }
    const res = await api.updateContentBlock(block.id, payload)
    if (res.error) {
      setError(res.error)
    } else if (res.data) {
      const data = res.data as { content_block: ContentBlock }
      onSaved(data.content_block)
      setExpanded(false)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete block "${block.title || block.block_type}"? This cannot be undone.`)) return
    setDeleting(true)
    const res = await api.deleteContentBlock(block.id)
    if (res.error) {
      setError(res.error)
      setDeleting(false)
    } else {
      onDeleted(block.id)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Block header row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <span className="text-slate-400">{blockTypeIcons[block.block_type] ?? <FileText className="h-4 w-4" />}</span>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {block.block_type.replace('_', ' ')}
        </span>
        <span className="text-sm text-slate-700 flex-1 truncate">{block.title || <em className="text-slate-400">Untitled</em>}</span>
        <span className="text-xs text-slate-400 mr-2">#{block.position}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 disabled:opacity-50 ml-1"
          title="Delete block"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline edit form */}
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

  const handleAdd = async () => {
    setSaving(true)
    setError(null)
    const payload: Record<string, string | number> = {
      block_type: blockType,
      position: nextPosition,
      title: form.title,
    }
    if (form.body) payload.body = form.body
    if (hasVideoUrl(blockType) && form.video_url) payload.video_url = form.video_url
    if (hasSolutionOrFilename(blockType)) {
      if (form.solution) payload.solution = form.solution
      if (form.filename) payload.filename = form.filename
    }
    const res = await api.createContentBlock(lessonId, payload)
    if (res.error) {
      setError(res.error)
    } else if (res.data) {
      const data = res.data as { content_block: ContentBlock }
      onAdded(data.content_block)
      setForm(emptyFormData())
      setOpen(false)
    }
    setSaving(false)
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
          onClick={() => { setOpen(false); setError(null) }}
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

  const nextPosition =
    lesson.content_blocks.length > 0
      ? Math.max(...lesson.content_blocks.map((b) => b.position)) + 1
      : 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to="/admin/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{lesson.title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {lesson.content_blocks.length} content block{lesson.content_blocks.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Content blocks list */}
      <div className="space-y-3">
        {lesson.content_blocks.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-slate-400 text-sm">
            No content blocks yet. Add one below.
          </div>
        )}

        {lesson.content_blocks
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((block) => (
            <EditBlockRow
              key={block.id}
              block={block}
              onSaved={handleBlockSaved}
              onDeleted={handleBlockDeleted}
            />
          ))}

        {/* Add block */}
        <AddBlockForm
          lessonId={lesson.id}
          nextPosition={nextPosition}
          onAdded={handleBlockAdded}
        />
      </div>
    </div>
  )
}
