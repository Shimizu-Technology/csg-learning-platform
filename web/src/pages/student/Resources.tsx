import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Link2, Search, Video, MessageSquare, Github, FileText, Globe } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface ResourceItem {
  id: number
  title: string
  url: string
  category: string
  description: string | null
}

const categoryConfig: Record<string, { label: string; icon: typeof Globe; color: string }> = {
  meeting: { label: 'Meeting', icon: Video, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  github: { label: 'GitHub', icon: Github, color: 'bg-slate-50 text-slate-700 border-slate-200' },
  communication: { label: 'Communication', icon: MessageSquare, color: 'bg-green-50 text-green-700 border-green-200' },
  documentation: { label: 'Docs', icon: FileText, color: 'bg-amber-50 text-amber-700 border-amber-200' },
  general: { label: 'General', icon: Globe, color: 'bg-slate-50 text-slate-600 border-slate-200' },
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
      resource.url.toLowerCase().includes(q) ||
      resource.category.toLowerCase().includes(q) ||
      (resource.description || '').toLowerCase().includes(q)
    )
  }, [resources, query])

  if (loading) return <LoadingSpinner message="Loading resources..." />

  if (resources.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="No resources yet"
        description="Class resources will appear here once your instructor adds them."
      />
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Class Resources</h1>
        <p className="mt-1 text-sm text-slate-500">Important links for your class.</p>
      </div>

      {resources.length > 4 && (
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
      )}

      <div className="space-y-3">
        {filtered.map((resource) => {
          const cat = categoryConfig[resource.category] || categoryConfig.general
          const Icon = cat.icon
          return (
            <a
              key={resource.id}
              href={sanitizeUrl(resource.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl border border-slate-200 bg-white p-5 hover:border-primary-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Icon className="h-5 w-5 text-primary-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-semibold text-slate-900">{resource.title}</h2>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.color}`}>
                        {cat.label}
                      </span>
                    </div>
                    {resource.description && (
                      <p className="mt-1 text-sm text-slate-600">{resource.description}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-400 break-all">{resource.url}</p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-slate-400 shrink-0 mt-1" />
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
