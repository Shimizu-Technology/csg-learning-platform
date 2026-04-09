import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Lock, Unlock, UserPlus, Mail, CheckCircle, PlayCircle, Link2, Plus, Trash2, CalendarDays, ExternalLink, Github } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'

interface Announcement {
  title: string
  body: string
  pinned: boolean
  published_at: string
}

interface Recording {
  title: string
  url: string
  date?: string
  description?: string
}

interface ClassResource {
  title: string
  url: string
  category?: string
  description?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CohortData = Record<string, any> & {
  id: number
  name: string
  curriculum_id: number
  curriculum_name: string
  start_date: string
  status: string
  active_count: number
  requires_github?: boolean
  repository_name?: string | null
  github_organization_name?: string | null
  announcements: Announcement[]
  recordings?: Recording[]
  class_resources?: ClassResource[]
  students: Array<{
    enrollment_id: number
    user_id: number
    full_name: string
    email: string
    status: string
    invite_pending?: boolean
  }>
  modules: Array<{
    id: number
    name: string
    module_type: string
    position: number
    lessons_count: number
    assigned_count: number
    assigned: boolean
    unlocked_count: number
    accessible_count: number
    unlock_date_overrides: string[]
    requires_github?: boolean
    repository_name?: string | null
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
  const [savingRecordings, setSavingRecordings] = useState(false)
  const [savingResources, setSavingResources] = useState(false)
  const [forms, setForms] = useState<Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }>>({})
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [classResources, setClassResources] = useState<ClassResource[]>([])
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [addStudentEmail, setAddStudentEmail] = useState('')
  const [addStudentGithub, setAddStudentGithub] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)
  const [resendingInviteFor, setResendingInviteFor] = useState<number | null>(null)
  const [editStartDate, setEditStartDate] = useState('')
  const [savingStartDate, setSavingStartDate] = useState(false)
  const [showRecordingsModal, setShowRecordingsModal] = useState(false)
  const [showResourcesModal, setShowResourcesModal] = useState(false)
  const [configureModuleId, setConfigureModuleId] = useState<number | null>(null)
  const [showAddModule, setShowAddModule] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')
  const [newModuleType, setNewModuleType] = useState('prework')
  const [addingModule, setAddingModule] = useState(false)

  useEffect(() => {
    if (!id) return
    api.getCohort(Number(id)).then((res) => {
      const nextCohort = res.data?.cohort
      if (nextCohort) {
        setCohort(nextCohort)
        setAnnouncements(nextCohort.announcements || [])
        setRecordings(nextCohort.recordings || [])
        setClassResources(nextCohort.class_resources || [])
        setEditStartDate(toDateInputValue(nextCohort.start_date))
        const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }> = {}
        nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
          nextForms[mod.id] = {
            unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
            unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
            requires_github: mod.requires_github || false,
            repository_name: mod.repository_name || '',
          }
        })
        setForms(nextForms)
      }
      setLoading(false)
    })
  }, [id])

  const handleSaveStartDate = async () => {
    if (!id || !editStartDate) return
    setSavingStartDate(true)
    setMessage('')
    const res = await api.updateCohort(Number(id), { start_date: editStartDate })
    if (res.error) {
      setMessage(res.error)
    } else if (res.data?.cohort) {
      setCohort(res.data.cohort)
      setMessage('Start date updated — exercise unlock schedule recalculated')
    }
    setSavingStartDate(false)
  }

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !addStudentEmail.trim()) return
    setAddingStudent(true)
    setMessage('')

    const createRes = await api.createUser({
      email: addStudentEmail.trim().toLowerCase(),
      role: 'student',
      github_username: addStudentGithub.trim() || undefined,
      skip_invite: !sendInvite,
    })
    if (createRes.error) {
      setMessage(createRes.error)
      setAddingStudent(false)
      return
    }

    const userId = createRes.data?.user?.id
    if (!userId) {
      setMessage('Failed to create user')
      setAddingStudent(false)
      return
    }

    const enrollRes = await api.createEnrollment(Number(id), userId)
    if (enrollRes.error) {
      setMessage(`User created but enrollment failed: ${enrollRes.error}`)
      setAddingStudent(false)
      return
    }

    const cohortRes = await api.getCohort(Number(id))
    if (cohortRes.data?.cohort) {
      setCohort(cohortRes.data.cohort)
      setAnnouncements(cohortRes.data.cohort.announcements || [])
    }

    setMessage(`Added ${addStudentEmail.trim()} to cohort`)
    setAddStudentEmail('')
    setAddStudentGithub('')
    setAddingStudent(false)
    setShowAddStudent(false)
  }

  const handleResendInvite = async (userId: number, email: string) => {
    setResendingInviteFor(userId)
    setMessage('')
    const res = await api.resendInvite(userId)
    if (res.error) {
      setMessage(`Failed to resend invite: ${res.error}`)
    } else {
      setMessage(`Invite re-sent to ${email}`)
    }
    setResendingInviteFor(null)
  }

  const updateForm = (moduleId: number, patch: Partial<{ unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }>) => {
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
      assigned: true,
      unlocked: form.unlocked,
      unlock_date_override: form.unlock_date_override || null,
      requires_github: form.requires_github,
      repository_name: form.repository_name,
    })

    if (res.error) {
      setMessage(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }> = {}
      nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
        nextForms[mod.id] = {
          unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
          unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
          requires_github: mod.requires_github || false,
          repository_name: mod.repository_name || '',
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

  const saveRecordings = async () => {
    if (!id) return
    setSavingRecordings(true)
    setMessage('')

    const res = await api.updateCohortRecordings(Number(id), recordings)
    if (res.error) {
      setMessage(res.error)
      setSavingRecordings(false)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      setRecordings(nextCohort.recordings || [])
    }
    setMessage('Updated class recordings')
    setSavingRecordings(false)
  }

  const saveClassResources = async () => {
    if (!id) return
    setSavingResources(true)
    setMessage('')

    const res = await api.updateCohortClassResources(Number(id), classResources)
    if (res.error) {
      setMessage(res.error)
      setSavingResources(false)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      setClassResources(nextCohort.class_resources || [])
    }
    setMessage('Updated class resources')
    setSavingResources(false)
  }

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cohort || !newModuleName.trim()) return
    setAddingModule(true)
    setMessage('')

    const position = cohort.modules.length + 1
    const res = await api.createModule(cohort.curriculum_id, {
      name: newModuleName.trim(),
      module_type: newModuleType,
      position,
    })
    if (res.error) {
      setMessage(`Failed to create module: ${res.error}`)
      setAddingModule(false)
      return
    }

    const cohortRes = await api.getCohort(Number(id))
    const nextCohort = cohortRes.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }> = {}
      nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
        nextForms[mod.id] = forms[mod.id] || {
          unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
          unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
          requires_github: mod.requires_github || false,
          repository_name: mod.repository_name || '',
        }
      })
      setForms(nextForms)
    }

    setMessage(`Created module "${newModuleName.trim()}"`)
    setNewModuleName('')
    setNewModuleType('prework')
    setAddingModule(false)
    setShowAddModule(false)
  }

  const assignModuleToCohort = async (moduleId: number) => {
    if (!id) return
    setSavingModuleId(moduleId)
    setMessage('')

    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      assigned: true,
      unlocked: false,
      unlock_date_override: null,
    })

    if (res.error) {
      setMessage(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }> = {}
      nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
        nextForms[mod.id] = {
          unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
          unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
          requires_github: mod.requires_github || false,
          repository_name: mod.repository_name || '',
        }
      })
      setForms(nextForms)
    }
    const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
    setMessage(`Assigned ${moduleName} — open Configure to set a start date`)
    setSavingModuleId(null)
    setConfigureModuleId(moduleId)
  }

  const removeModuleFromCohort = async (moduleId: number) => {
    if (!id) return
    setSavingModuleId(moduleId)
    setMessage('')

    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      assigned: false,
    })

    if (res.error) {
      setMessage(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort
    if (nextCohort) {
      setCohort(nextCohort)
      const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string; requires_github: boolean; repository_name: string }> = {}
      nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
        nextForms[mod.id] = {
          unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
          unlock_date_override: toDateInputValue(mod.unlock_date_overrides?.[0] || ''),
          requires_github: mod.requires_github || false,
          repository_name: mod.repository_name || '',
        }
      })
      setForms(nextForms)
    }
    const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
    setMessage(`Removed ${moduleName} from cohort assignments`)
    setSavingModuleId(null)
  }

  if (loading) return <LoadingSpinner message="Loading cohort..." />
  if (!cohort) return null

  const upcomingUnlocks = cohort.modules
    .filter((mod) => mod.assigned && mod.unlock_date_overrides.length > 0)
    .sort((a, b) => new Date(a.unlock_date_overrides[0]).getTime() - new Date(b.unlock_date_overrides[0]).getTime())
    .slice(0, 5)

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link to="/admin/cohorts" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Cohorts
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{cohort.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {cohort.curriculum_name} · {cohort.active_count} active student{cohort.active_count !== 1 ? 's' : ''}
        </p>
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Cohort Start Date
            </label>
            <input
              type="date"
              value={editStartDate}
              onChange={(e) => setEditStartDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {editStartDate !== toDateInputValue(cohort.start_date) && (
            <button
              onClick={handleSaveStartDate}
              disabled={savingStartDate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {savingStartDate ? 'Saving...' : 'Update Date'}
            </button>
          )}
          <p className="text-xs text-slate-400 pb-2">Fallback start date for modules without their own start date.</p>
        </div>
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

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Cohort Modules</h2>
            <button
              onClick={() => setShowAddModule(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Module
            </button>
          </div>

          <Modal
            open={showAddModule}
            onClose={() => setShowAddModule(false)}
            title="Add Module"
            subtitle={`Add a new module to ${cohort.curriculum_name}`}
            size="md"
          >
            <form onSubmit={handleAddModule} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Module Name</label>
                <input
                  type="text"
                  required
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  placeholder="e.g., Live Class, Capstone Project"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Module Type</label>
                <select
                  value={newModuleType}
                  onChange={(e) => setNewModuleType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="prework">Prework</option>
                  <option value="live_class">Live Class</option>
                  <option value="post_work">Post Work</option>
                  <option value="supplementary">Supplementary</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={addingModule || !newModuleName.trim()}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {addingModule ? 'Creating...' : 'Create Module'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModule(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Modal>

          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {cohort.modules.map((mod) => {
              const form = forms[mod.id] || { unlocked: false, unlock_date_override: '', requires_github: false, repository_name: '' }
              const saving = savingModuleId === mod.id
              return (
                <div key={mod.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {(() => {
                      const isAccessible = form.unlocked || (form.unlock_date_override && new Date(form.unlock_date_override + 'T00:00:00') <= new Date())
                      const isScheduled = !form.unlocked && form.unlock_date_override && new Date(form.unlock_date_override + 'T00:00:00') > new Date()
                      return (
                        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                          !mod.assigned ? 'bg-slate-100 text-slate-400'
                            : isAccessible ? 'bg-green-50 text-green-600'
                            : isScheduled ? 'bg-blue-50 text-blue-600'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {!mod.assigned ? <Lock className="h-4 w-4" />
                            : isAccessible ? <Unlock className="h-4 w-4" />
                            : isScheduled ? <CalendarDays className="h-4 w-4" />
                            : <Lock className="h-4 w-4" />}
                        </div>
                      )
                    })()}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{mod.name}</p>
                      <p className="text-xs text-slate-500 capitalize">
                        {mod.module_type.replace('_', ' ')} · {mod.lessons_count} lesson{mod.lessons_count !== 1 ? 's' : ''} · {mod.assigned_count} assigned
                        {form.unlock_date_override && ` · Starts ${form.unlock_date_override}`}
                        {form.requires_github && ' · GitHub'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!mod.assigned ? (
                      <button
                        onClick={() => assignModuleToCohort(mod.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {saving ? 'Adding...' : 'Assign'}
                      </button>
                    ) : (
                      <>
                        <Link
                          to={`/admin/cohorts/${id}/modules/${mod.id}/grading`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          Grading
                        </Link>
                        <button
                          onClick={() => setConfigureModuleId(mod.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          Configure
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Module Configuration Modal */}
          {(() => {
            const configureMod = cohort.modules.find((m) => m.id === configureModuleId)
            if (!configureMod) return null
            const form = forms[configureMod.id] || { unlocked: false, unlock_date_override: '', requires_github: false, repository_name: '' }
            const saving = savingModuleId === configureMod.id
            return (
              <Modal
                open
                onClose={() => setConfigureModuleId(null)}
                title={configureMod.name}
                subtitle={`${configureMod.module_type.replace('_', ' ')} · ${configureMod.lessons_count} lessons`}
                size="lg"
                footer={
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        removeModuleFromCohort(configureMod.id)
                        setConfigureModuleId(null)
                      }}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove from Cohort
                    </button>
                    <button
                      onClick={async () => {
                        await saveModuleAccess(configureMod.id)
                      }}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                }
              >
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Assigned</p>
                      <p className="font-semibold text-slate-900">{configureMod.assigned_count}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Accessible</p>
                      <p className="font-semibold text-slate-900">{configureMod.accessible_count}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                      <p className="text-xs text-slate-500">Force Unlocked</p>
                      <p className="font-semibold text-slate-900">{configureMod.unlocked_count}</p>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Module Start Date
                    </label>
                    <input
                      type="date"
                      value={form.unlock_date_override}
                      onChange={(e) => updateForm(configureMod.id, { unlock_date_override: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Lessons unlock progressively based on the module's schedule, starting from this date.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.unlocked}
                      onChange={(e) => updateForm(configureMod.id, { unlocked: e.target.checked })}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    Make module accessible (lessons still follow their release-day schedule)
                  </label>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.requires_github}
                        onChange={(e) => updateForm(configureMod.id, { requires_github: e.target.checked })}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      <Github className="h-3.5 w-3.5" />
                      Require GitHub submissions for this module
                    </label>
                    {form.requires_github && (
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Repository Name</label>
                        <input
                          type="text"
                          value={form.repository_name}
                          onChange={(e) => updateForm(configureMod.id, { repository_name: e.target.value })}
                          placeholder="e.g., prework-exercises"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <p className="mt-1 text-xs text-slate-400">The repo name under each student's GitHub account to sync from.</p>
                      </div>
                    )}
                  </div>
                </div>
              </Modal>
            )
          })()}

          {/* Recordings & Resources — compact summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setShowRecordingsModal(true)}
              className="rounded-2xl bg-white border border-slate-200 p-5 text-left hover:border-primary-200 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                    <PlayCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Class Recordings</h3>
                    <p className="text-xs text-slate-500">
                      {recordings.length === 0 ? 'No recordings yet' : `${recordings.length} recording${recordings.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-slate-300 group-hover:text-primary-500 transition-colors" />
              </div>
            </button>

            <button
              onClick={() => setShowResourcesModal(true)}
              className="rounded-2xl bg-white border border-slate-200 p-5 text-left hover:border-primary-200 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Class Resources</h3>
                    <p className="text-xs text-slate-500">
                      {classResources.length === 0 ? 'No resources yet' : `${classResources.length} resource${classResources.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-slate-300 group-hover:text-primary-500 transition-colors" />
              </div>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {upcomingUnlocks.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-slate-900">Upcoming Unlocks</h2>
              <div className="mt-3 space-y-2">
                {upcomingUnlocks.map((mod) => (
                  <div key={`${mod.id}-${mod.unlock_date_overrides[0]}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{mod.name}</p>
                      <p className="text-xs text-slate-500 capitalize">{mod.module_type.replace('_', ' ')} · {mod.assigned_count} assigned</p>
                    </div>
                    <span className="text-xs font-medium text-slate-600 shrink-0">
                      {new Date(mod.unlock_date_overrides[0]).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Enrolled Students</h2>
              <p className="text-sm text-slate-500 mt-1">{cohort.students.length} student{cohort.students.length !== 1 ? 's' : ''} enrolled</p>
            </div>
            <button
              onClick={() => setShowAddStudent(!showAddStudent)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add Student
            </button>
          </div>

          {showAddStudent && (
            <form onSubmit={handleAddStudent} className="rounded-xl border border-primary-200 bg-primary-50 p-4 space-y-3">
              <p className="text-xs text-slate-600">
                Enter the student's email. Their name will be filled automatically when they sign in via Clerk.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={addStudentEmail}
                  onChange={(e) => setAddStudentEmail(e.target.value)}
                  placeholder="student@example.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">GitHub Username (optional)</label>
                <input
                  type="text"
                  value={addStudentGithub}
                  onChange={(e) => setAddStudentGithub(e.target.value)}
                  placeholder="e.g., octocat"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Send invite email
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={addingStudent}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {addingStudent ? 'Adding...' : 'Add Student'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddStudent(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {cohort.students.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No students enrolled yet. Use the Add Student button above.
              </div>
            ) : cohort.students.map((student) => (
              <div
                key={student.enrollment_id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <Link
                  to={`/admin/students/${student.user_id}`}
                  className="min-w-0 flex-1 hover:opacity-80 transition-opacity"
                >
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {student.full_name || student.email}
                  </p>
                  {student.full_name && (
                    <p className="text-xs text-slate-500 truncate">{student.email}</p>
                  )}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {student.invite_pending ? (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700">
                        <Mail className="h-3 w-3" />
                        Invite sent
                      </span>
                      <button
                        onClick={() => handleResendInvite(student.user_id, student.email)}
                        disabled={resendingInviteFor === student.user_id}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <Mail className="h-3 w-3" />
                        {resendingInviteFor === student.user_id ? 'Sending...' : 'Resend'}
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-1 text-xs font-medium text-green-700">
                      <CheckCircle className="h-3 w-3" />
                      Signed in
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recordings Modal */}
      <Modal
        open={showRecordingsModal}
        onClose={() => setShowRecordingsModal(false)}
        title="Class Recordings"
        subtitle="YouTube links of recorded class sessions for students to review."
        icon={<PlayCircle className="h-6 w-6 text-primary-500" />}
        size="xl"
        footer={
          <div className="flex items-center justify-between">
            <button
              onClick={() => setRecordings((prev) => [...prev, { title: '', url: '', date: new Date().toISOString().slice(0, 10) }])}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add recording
            </button>
            <button
              onClick={saveRecordings}
              disabled={savingRecordings}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {savingRecordings ? 'Saving...' : 'Save Recordings'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {recordings.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No recordings added yet. Click "Add recording" below to get started.</p>
          ) : recordings.map((rec, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Recording {idx + 1}</span>
                <button
                  onClick={() => setRecordings((prev) => prev.filter((_, i) => i !== idx))}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
              <input
                type="text"
                value={rec.title}
                onChange={(e) => setRecordings((prev) => prev.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))}
                placeholder="e.g., Week 1 Day 1 — Intro to HTML"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="url"
                    value={rec.url}
                    onChange={(e) => setRecordings((prev) => prev.map((item, i) => i === idx ? { ...item, url: e.target.value } : item))}
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <input
                  type="date"
                  value={rec.date || ''}
                  onChange={(e) => setRecordings((prev) => prev.map((item, i) => i === idx ? { ...item, date: e.target.value } : item))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <input
                type="text"
                value={rec.description || ''}
                onChange={(e) => setRecordings((prev) => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                placeholder="Optional description"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* Resources Modal */}
      <Modal
        open={showResourcesModal}
        onClose={() => setShowResourcesModal(false)}
        title="Class Resources"
        subtitle="Important links for this cohort — Zoom, GitHub, Slack, etc."
        icon={<Link2 className="h-6 w-6 text-primary-500" />}
        size="xl"
        footer={
          <div className="flex items-center justify-between">
            <button
              onClick={() => setClassResources((prev) => [...prev, { title: '', url: '', category: 'general' }])}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add resource
            </button>
            <button
              onClick={saveClassResources}
              disabled={savingResources}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {savingResources ? 'Saving...' : 'Save Resources'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {classResources.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No resources added yet. Click "Add resource" below to get started.</p>
          ) : classResources.map((res, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Resource {idx + 1}</span>
                <button
                  onClick={() => setClassResources((prev) => prev.filter((_, i) => i !== idx))}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={res.title}
                    onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))}
                    placeholder="e.g., Class Zoom Link"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <select
                  value={res.category || 'general'}
                  onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, category: e.target.value } : item))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="general">General</option>
                  <option value="meeting">Meeting Link</option>
                  <option value="github">GitHub</option>
                  <option value="communication">Communication</option>
                  <option value="documentation">Documentation</option>
                </select>
              </div>
              <input
                type="url"
                value={res.url}
                onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, url: e.target.value } : item))}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="text"
                value={res.description || ''}
                onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                placeholder="Optional description"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
