import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  BookOpen,
  FileText,
  Play,
  Code,
  Eye,
  Pencil,
  Plus,
} from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NewLessonModal } from './NewLessonModal'
import { NewModuleModal } from './NewModuleModal'

interface Curriculum {
  id: number
  name: string
  status: string
  modules: Array<{
    id: number
    name: string
    module_type: string
    position: number
    lessons: Array<{
      id: number
      title: string
      lesson_type: string
      position: number
      release_day: number
      content_blocks_count: number
    }>
  }>
}

const typeIcons: Record<string, React.ReactNode> = {
  video: <Play className="h-3.5 w-3.5" />,
  exercise: <Code className="h-3.5 w-3.5" />,
  reading: <FileText className="h-3.5 w-3.5" />,
  project: <BookOpen className="h-3.5 w-3.5" />,
}

export function ContentManagement() {
  const navigate = useNavigate()
  const [curricula, setCurricula] = useState<Curriculum[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set())
  const [newLessonModal, setNewLessonModal] = useState<{ moduleId: number; moduleName: string; curriculumId: number; lessonCount: number; lastReleaseDay: number } | null>(null)
  const [newModuleModal, setNewModuleModal] = useState<{ curriculumId: number; moduleCount: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [lessonCreateError, setLessonCreateError] = useState('')
  const [moduleCreateError, setModuleCreateError] = useState('')

  useEffect(() => {
    api.getCurricula().then(async (res) => {
      if (res.data?.curricula) {
        const detailed = await Promise.all(
          res.data.curricula.map(async (c: any) => {
            const detail = await api.getCurriculum(c.id)
            return detail.data?.curriculum || c
          })
        )
        setCurricula(detailed)
      }
      setLoading(false)
    })
  }, [])

  const toggleModule = (moduleId: number) => {
    const next = new Set(expandedModules)
    if (next.has(moduleId)) {
      next.delete(moduleId)
    } else {
      next.add(moduleId)
    }
    setExpandedModules(next)
  }

  if (loading) return <LoadingSpinner message="Loading content..." />

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Admin Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Content Management</h1>
      </div>

      {curricula.map((curriculum) => (
        <div key={curriculum.id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{curriculum.name}</h2>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  curriculum.status === 'active' ? 'bg-success-100 text-success-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {curriculum.status}
                </span>
              </div>
              <button
                onClick={() => {
                  setModuleCreateError('')
                  setNewModuleModal({ curriculumId: curriculum.id, moduleCount: curriculum.modules?.length || 0 })
                }}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Module
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {curriculum.modules?.map((mod) => (
              <div key={mod.id}>
                <button
                  onClick={() => toggleModule(mod.id)}
                  className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  {expandedModules.has(mod.id) ? (
                    <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{mod.name}</p>
                    <p className="text-xs text-slate-500 capitalize">
                      {mod.module_type.replace('_', ' ')} · {mod.lessons?.length || 0} lessons
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLessonCreateError('')
                      setNewLessonModal({
                        moduleId: mod.id,
                        moduleName: mod.name,
                        curriculumId: curriculum.id,
                        lessonCount: mod.lessons?.length || 0,
                        lastReleaseDay: mod.lessons && mod.lessons.length > 0
                          ? Math.max(...mod.lessons.map((lesson) => lesson.release_day))
                          : 0,
                      })
                    }}
                    className="ml-2 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Lesson
                  </button>
                </button>

                {expandedModules.has(mod.id) && mod.lessons && (
                  <div className="px-6 pb-4 pl-14">
                    <div className="space-y-1">
                      {mod.lessons.map((lesson) => (
                        <div
                          key={lesson.id}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-100 transition-colors group"
                        >
                          <div className="text-slate-400 flex-shrink-0">
                            {typeIcons[lesson.lesson_type] || <FileText className="h-3.5 w-3.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 truncate">{lesson.title}</p>
                            <p className="text-xs text-slate-400">
                              Day {lesson.release_day} · {lesson.content_blocks_count} blocks
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link
                              to={`/admin/lessons/${lesson.id}/edit`}
                              title="Edit lesson content"
                              className="rounded-lg p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                            <Link
                              to={`/lessons/${lesson.id}`}
                              title="Student preview"
                              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {newLessonModal && (
        <NewLessonModal
          moduleId={newLessonModal.moduleId}
          moduleName={newLessonModal.moduleName}
          defaultPosition={newLessonModal.lessonCount}
          defaultReleaseDay={newLessonModal.lastReleaseDay + 1}
          saving={saving}
          error={lessonCreateError}
          onClose={() => {
            setLessonCreateError('')
            setNewLessonModal(null)
          }}
          onCreate={async (data) => {
            setSaving(true)
            setLessonCreateError('')
            const res = await api.createLesson(newLessonModal.moduleId, data)
            if (res.error) {
              setLessonCreateError(res.error)
              setSaving(false)
              return
            }

            const lessonId = res.data?.lesson?.id
            setSaving(false)
            setNewLessonModal(null)
            if (lessonId) {
              navigate(`/admin/lessons/${lessonId}/edit`)
            }
          }}
        />
      )}

      {newModuleModal && (
        <NewModuleModal
          curriculumId={newModuleModal.curriculumId}
          defaultPosition={newModuleModal.moduleCount}
          saving={saving}
          error={moduleCreateError}
          onClose={() => {
            setModuleCreateError('')
            setNewModuleModal(null)
          }}
          onCreate={async (data) => {
            setSaving(true)
            setModuleCreateError('')
            const createRes = await api.createModule(newModuleModal.curriculumId, data)
            if (createRes.error) {
              setModuleCreateError(createRes.error)
              setSaving(false)
              return
            }

            const detail = await api.getCurriculum(newModuleModal.curriculumId)
            const updated = detail.data?.curriculum
            if (updated) {
              setCurricula(prev => prev.map(c => c.id === newModuleModal.curriculumId ? updated : c))
            }
            setSaving(false)
            setNewModuleModal(null)
          }}
        />
      )}
    </div>
  )
}
