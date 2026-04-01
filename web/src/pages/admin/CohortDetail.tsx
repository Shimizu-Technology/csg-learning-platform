import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Users, Lock, Unlock } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

interface Announcement {
  title: string
  body: string
  pinned: boolean
  published_at: string
}

interface CohortData {
  id: number
  name: string
  curriculum_name: string
  start_date: string
  status: string
  active_count: number
  announcements: Announcement[]
  students: Array<{
    enrollment_id: number
    user_id: number
    full_name: string
    email: string
    status: string
  }>
  modules: Array<{
    id: number
    name: string
    module_type: string
    position: number
    lessons_count: number
    assigned_count: number
    unlocked_count: number
    unlock_date_overrides: string[]
  }>
}

function toDateInputValue(dateStr?: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toISOString().slice(0, 10)
}

export function CohortDetail() {
  const { id } = useParams<{ id: string }>()
  const [cohort, setCohort] = useState<CohortData | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [savingModuleId, setSavingModuleId] = useState<number | null>(null)
  const [savingAnnouncements, setSavingAnnouncements] = useState(false)
  const [forms, setForms] = useState<Record<number, { unlocked: boolean; unlock_date_override: string }>>({})
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    if (!id) return
    api.getCohort(Number(id)).then((res) => {
      const nextCohort = res.data?.cohort
      if (nextCohort) {
        setCohort(nextCohort)
        setAnnouncements(nextCohort.announcements || [])
        const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string }> = {}
        nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
          nextForms[mod.id] = {
            unlocked: nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false,
            unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
          }
        })
        setForms(nextForms)
        setAnnouncements(nextCohort.announcements || [])
      }
      setLoading(false)
    })
  }, [id])

  const updateForm = (moduleId: number, patch: Partial<{ unlocked: boolean; unlock_date_override: string }>) => {
    setForms((prev) => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        ...patch,
      },
    }))
  }

  const saveModuleAccess = async (moduleId: number) => {
    if (!id) return
    const form = forms[moduleId]
    if (!form) return

    setSavingModuleId(moduleId)
    setMessage('')
    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      unlocked: form.unlocked,
      unlock_date_override: form.unlock_date_override || null,
    })

    if (res.error) {
      setMessage(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string }> = {}
      nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
        nextForms[mod.id] = {
          unlocked: nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false,
          unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
        }
      })
      setForms(nextForms)
    }

    const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
    setMessage(`Updated cohort access for ${moduleName}`)
    setSavingModuleId(null)
  }

  const saveAnnouncements = async () => {
    if (!id) return
    setSavingAnnouncements(true)
    setMessage('')

    const res = await api.updateCohortAnnouncements(Number(id), announcements)
    if (res.error) {
      setMessage(res.error)
      setSavingAnnouncements(false)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      setAnnouncements(nextCohort.announcements || [])
    }
    setMessage('Updated cohort announcements')
    setSavingAnnouncements(false)
  }

  if (loading) return <LoadingSpinner message="Loading cohort..." />
  if (!cohort) return null

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Admin Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{cohort.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {cohort.curriculum_name} · Starts {new Date(cohort.start_date).toLocaleDateString()} · {cohort.active_count} active students
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <div className="space-y-3 rounded-2xl bg-white border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Announcements</h2>
                <p className="text-sm text-slate-500 mt-1">Short notices that students in this cohort will see on their dashboard.</p>
              </div>
              <button
                onClick={() => setAnnouncements((prev) => [...prev, { title: '', body: '', pinned: false, published_at: new Date().toISOString() }])}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Add notice
              </button>
            </div>

            <div className="space-y-3">
              {announcements.length === 0 ? (
                <p className="text-sm text-slate-400">No announcements yet.</p>
              ) : announcements.map((announcement, idx) => (
                <div key={`${idx}-${announcement.published_at}`} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={announcement.pinned}
                        onChange={(e) => setAnnouncements((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, pinned: e.target.checked } : item))}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      Pin this notice
                    </label>
                    <button
                      onClick={() => setAnnouncements((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    value={announcement.title}
                    onChange={(e) => setAnnouncements((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, title: e.target.value } : item))}
                    placeholder="Announcement title"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <textarea
                    value={announcement.body}
                    onChange={(e) => setAnnouncements((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, body: e.target.value } : item))}
                    placeholder="What should students know?"
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={saveAnnouncements}
              disabled={savingAnnouncements}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {savingAnnouncements ? 'Saving...' : 'Save Announcements'}
            </button>
          </div>

          <h2 className="text-lg font-semibold text-slate-900">Cohort Module Access</h2>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {cohort.modules.map((mod) => {
              const form = forms[mod.id] || { unlocked: false, unlock_date_override: '' }
              const saving = savingModuleId === mod.id
              return (
                <div key={mod.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{mod.name}</p>
                      <p className="text-xs text-slate-500 capitalize">
                        {mod.module_type.replace('_', ' ')} · {mod.lessons_count} lessons
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${form.unlocked ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                      {form.unlocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {form.unlocked ? 'Unlocked by default' : 'Locked by default'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Assigned</p>
                      <p className="font-semibold text-slate-900">{mod.assigned_count}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Unlocked</p>
                      <p className="font-semibold text-slate-900">{mod.unlocked_count}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Overrides</p>
                      <p className="font-semibold text-slate-900">{mod.unlock_date_overrides.length}</p>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.unlocked}
                      onChange={(e) => updateForm(mod.id, { unlocked: e.target.checked })}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    Unlock this module for all active cohort students
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Default unlock date override</label>
                    <input
                      type="date"
                      value={form.unlock_date_override}
                      onChange={(e) => updateForm(mod.id, { unlock_date_override: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Applies the same override date to all active enrollments for this module.
                    </p>
                  </div>

                  <button
                    onClick={() => saveModuleAccess(mod.id)}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Cohort Defaults'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Enrolled Students</h2>
            <p className="text-sm text-slate-500 mt-1">Student-level overrides can still be managed individually.</p>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {cohort.students.map((student) => (
              <Link
                key={student.enrollment_id}
                to={`/admin/students/${student.user_id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{student.full_name}</p>
                  <p className="text-xs text-slate-500 truncate">{student.email}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  <Users className="h-3 w-3" />
                  {student.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
