import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  FileText,
  Code,
  CheckCircle2,
  BookOpen,
  Mic,
  Pencil,
  X,
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
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
}

interface Lesson {
  id: number
  title: string
  lesson_type: string
  module_id: number
  content_blocks: ContentBlock[]
}

type BlockType = 'video' | 'text' | 'exercise' | 'code_challenge' | 'checkpoint' | 'recording'

const BLOCK_TYPES: { value: BlockType; label: string }[] = [
  { value: 'video', label: 'Video' },
  { value: 'text', label: 'Text' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'code_challenge', label: 'Code Challenge' },
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'recording', label: 'Recording' },
]

const blockIcons: Record<string, React.ReactNode> = {
  video: <Play className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  exercise: <Code className="h-4 w-4" />,
  code_challenge: <Code className="h-4 w-4" />,
  checkpoint: <CheckCircle2 className="h-4 w-4" />,
  recording: <Mic className="h-4 w-4" />,
  reading: <BookOpen className="h-4 w-4" />,
}

interface BlockFormState {
  block_type: BlockType
  title: string
  body: string
  video_url: string
  filename: string
  solution: string
}

const emptyForm: BlockFormState = {
  block_type: 'text',
  title: '',
  body: '',
  video_url: '',
  filename: '',
  solution: '',
}

function blockToForm(block: ContentBlock): BlockFormState {
  return {
    block_type: block.block_type as BlockType,
    title: block.title ?? '',
    body: block.body ?? '',
    video_url: block.video_url ?? '',
    filename: block.filename ?? '',
    solution: block.solution ?? '',
  }
}

interface BlockFormProps {
  initial: BlockFormState
  submitLabel: string
  onSubmit: (data: BlockFormState) => Promise<void>
  onCancel?: () => void
  saving: boolean
}

function BlockForm({ initial, submitLabel, onSubmit, onCancel, saving }: BlockFormProps) {
  const [form, setForm] = useState<BlockFormState>(initial)

  const set = (field: keyof BlockFormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const showVideoUrl = form.block_type === 'video' || form.block_type === 'recording'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Block Type */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Block Type</label>
        <select
          value={form.block_type}
          onChange={(e) => set('block_type', e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          {BLOCK_TYPES.map((bt) => (
            <option key={bt.value} value={bt.value}>{bt.label}</option>
          ))}
        </select>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Title <span className="text-slate-400 font-normal">(optional)</span></label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Block title"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Video URL (conditional) */}
      {showVideoUrl && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Video URL <span className="text-slate-400 font-normal">(optional)</span></label>
          <input
            type="url"
            value={form.video_url}
            onChange={(e) => set('video_url', e.target.value)}
            placeholder="https://vimeo.com/... or https://youtube.com/watch?v=..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      )}

      {/* Body */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Content / Prompt <span className="text-slate-400 font-normal">(optional — supports Markdown)</span></label>
        <textarea
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          placeholder="Markdown content..."
          rows={6}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y font-mono"
        />
      </div>

      {/* Filename */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Filename hint <span className="text-slate-400 font-normal">(optional)</span></label>
        <input
          type="text"
          value={form.filename}
          onChange={(e) => set('filename', e.target.value)}
          placeholder="e.g. app/models/user.rb"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Solution */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Solution <span className="text-slate-400 font-normal">(staff-only, optional)</span></label>
        <textarea
          value={form.solution}
          onChange={(e) => set('solution', e.target.value)}
          placeholder="Solution code or notes..."
          rows={4}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y font-mono"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function LessonEditor() {
  const { lessonId } = useParams<{ lessonId: string }>()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [deletingBlockId, setDeletingBlockId] = useState<number | null>(null)
  const [reorderingBlockId, setReorderingBlockId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const loadLesson = async () => {
    if (!lessonId) return
    const res = await api.getLesson(Number(lessonId))
    if (res.error) {
      setError(res.error)
    } else if (res.data?.lesson) {
      setLesson(res.data.lesson)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadLesson()
  }, [lessonId])

  const handleAddBlock = async (form: BlockFormState) => {
    if (!lesson) return
    setAddSaving(true)
    const nextPosition = lesson.content_blocks.length
      ? Math.max(...lesson.content_blocks.map((b) => b.position)) + 1
      : 1
    const payload: Record<string, unknown> = {
      block_type: form.block_type,
      position: nextPosition,
    }
    if (form.title) payload.title = form.title
    if (form.body) payload.body = form.body
    if (form.video_url) payload.video_url = form.video_url
    if (form.filename) payload.filename = form.filename
    if (form.solution) payload.solution = form.solution

    const res = await api.createContentBlock(lesson.id, payload)
    setAddSaving(false)
    if (!res.error) {
      await loadLesson()
    }
  }

  const handleEditBlock = async (block: ContentBlock, form: BlockFormState) => {
    setEditSaving(true)
    const payload: Record<string, unknown> = {
      block_type: form.block_type,
      title: form.title || null,
      body: form.body || null,
      video_url: form.video_url || null,
      filename: form.filename || null,
      solution: form.solution || null,
    }
    const res = await api.updateContentBlock(block.id, payload)
    setEditSaving(false)
    if (!res.error) {
      setEditingBlockId(null)
      await loadLesson()
    }
  }

  const handleDeleteBlock = async (blockId: number) => {
    setDeletingBlockId(blockId)
    const res = await api.deleteContentBlock(blockId)
    setDeletingBlockId(null)
    setConfirmDeleteId(null)
    if (!res.error) {
      await loadLesson()
    }
  }

  const handleMoveBlock = async (block: ContentBlock, direction: 'up' | 'down') => {
    if (!lesson) return
    const sorted = [...lesson.content_blocks].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex((b) => b.id === block.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const swapBlock = sorted[swapIdx]
    setReorderingBlockId(block.id)

    // Swap positions
    await Promise.all([
      api.updateContentBlock(block.id, { position: swapBlock.position }),
      api.updateContentBlock(swapBlock.id, { position: block.position }),
    ])

    setReorderingBlockId(null)
    await loadLesson()
  }

  if (loading) return <LoadingSpinner message="Loading lesson..." />
  if (error) return (
    <div className="rounded-2xl bg-red-50 border border-red-200 p-6 text-red-700 text-sm">{error}</div>
  )
  if (!lesson) return null

  const sortedBlocks = [...lesson.content_blocks].sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/admin/content"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Content Management
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{lesson.title}</h1>
        <p className="text-sm text-slate-500 capitalize mt-1">
          {lesson.lesson_type.replace('_', ' ')} · {sortedBlocks.length} block{sortedBlocks.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Content Blocks */}
      {sortedBlocks.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-base font-semibold text-slate-900">Content Blocks</h2>
            <p className="text-xs text-slate-500 mt-0.5">Use the arrows to reorder blocks. Changes save immediately.</p>
          </div>
          <div className="divide-y divide-slate-200">
            {sortedBlocks.map((block, idx) => (
              <div key={block.id} className="px-6 py-4">
                {editingBlockId === block.id ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-slate-700">Edit Block</h3>
                    </div>
                    <BlockForm
                      initial={blockToForm(block)}
                      submitLabel="Save Changes"
                      saving={editSaving}
                      onSubmit={(form) => handleEditBlock(block, form)}
                      onCancel={() => setEditingBlockId(null)}
                    />
                  </div>
                ) : confirmDeleteId === block.id ? (
                  <div className="flex items-center gap-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <p className="text-sm text-red-700 flex-1">
                      Delete this block? This cannot be undone.
                    </p>
                    <button
                      onClick={() => handleDeleteBlock(block.id)}
                      disabled={deletingBlockId === block.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deletingBlockId === block.id ? 'Deleting...' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5 flex-shrink-0 mt-0.5">
                      <button
                        onClick={() => handleMoveBlock(block, 'up')}
                        disabled={idx === 0 || reorderingBlockId === block.id}
                        className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        title="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveBlock(block, 'down')}
                        disabled={idx === sortedBlocks.length - 1 || reorderingBlockId === block.id}
                        className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        title="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Block icon */}
                    <div className="mt-1 text-slate-400 flex-shrink-0">
                      {blockIcons[block.block_type] ?? <FileText className="h-4 w-4" />}
                    </div>

                    {/* Block content summary */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-slate-500 capitalize bg-slate-100 px-2 py-0.5 rounded-full">
                          {block.block_type.replace('_', ' ')}
                        </span>
                        {block.title && (
                          <span className="text-sm font-medium text-slate-800">{block.title}</span>
                        )}
                        <span className="text-xs text-slate-400">#{idx + 1}</span>
                      </div>
                      {block.body && (
                        <p className="mt-1 text-sm text-slate-500 truncate">
                          {block.body.slice(0, 100)}{block.body.length > 100 ? '…' : ''}
                        </p>
                      )}
                      {block.video_url && (
                        <p className="mt-1 text-xs text-slate-400 truncate">{block.video_url}</p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => { setEditingBlockId(block.id); setConfirmDeleteId(null) }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteId(block.id); setEditingBlockId(null) }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sortedBlocks.length === 0 && (
        <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 px-6 py-10 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-500">No content blocks yet</p>
          <p className="text-xs text-slate-400 mt-1">Add your first block below to get started.</p>
        </div>
      )}

      {/* Add Block Form */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Add Block</h2>
          </div>
        </div>
        <div className="px-6 py-5">
          <BlockForm
            initial={emptyForm}
            submitLabel="Add Block"
            saving={addSaving}
            onSubmit={handleAddBlock}
          />
        </div>
      </div>
    </div>
  )
}
