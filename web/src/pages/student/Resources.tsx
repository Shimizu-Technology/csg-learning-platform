import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, BookOpen, Link2, Search } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface ResourceItem {
  id: string
  title: string
  url: string
  module_id: number
  module_name: string
  lesson_id: number
  lesson_title: string
  content_block_id: number
  content_block_title: string | null
  unlock_date: string | null
}

export function Resources() {
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.getResources().then((res) => {
      if (res.data?.resources) setResources(res.data.resources)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return resources
    return resources.filter((resource) =>
      resource.title.toLowerCase().includes(q) ||
      resource.module_name.toLowerCase().includes(q) ||
      resource.lesson_title.toLowerCase().includes(q) ||
      resource.url.toLowerCase().includes(q)
    )
  }, [resources, query])

  if (loading) return <LoadingSpinner message="Loading resources..." />

  if (resources.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="No resources yet"
        description="Once lesson content includes important links, they’ll appear here for students."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
        <p className="mt-1 text-sm text-slate-500">Important links from your unlocked lessons, all in one place.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search resources..."
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((resource) => (
          <div key={resource.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900 truncate">{resource.title}</h2>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5" />
                    {resource.module_name}
                  </span>
                  <span>{resource.lesson_title}</span>
                  {resource.content_block_title && <span>{resource.content_block_title}</span>}
                </div>
                <p className="mt-2 text-xs text-slate-400 break-all">{resource.url}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to={`/lessons/${resource.lesson_id}`}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Open lesson
                </Link>
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
                >
                  Open link
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
