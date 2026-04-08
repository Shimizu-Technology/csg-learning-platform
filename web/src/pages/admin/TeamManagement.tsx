import { useEffect, useState } from 'react'
import { Shield, ShieldCheck, UserPlus, Mail, ChevronDown, Pencil, Trash2, RotateCcw, X, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { useAuthContext } from '../../contexts/AuthContext'

interface TeamMember {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string
  role: string
  github_username: string | null
  avatar_url: string | null
  last_sign_in_at: string | null
  invite_pending: boolean
  created_at: string
}

interface EditDraft {
  first_name: string
  last_name: string
  email: string
  role: string
  github_username: string
}

export function TeamManagement() {
  const { user: currentUser } = useAuthContext()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('instructor')
  const [addGithub, setAddGithub] = useState('')
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<TeamMember | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [resendingId, setResendingId] = useState<number | null>(null)

  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const showNotification = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') {
      setSuccessMsg(msg)
      setErrorMsg('')
    } else {
      setErrorMsg(msg)
      setSuccessMsg('')
    }
    setTimeout(() => { setSuccessMsg(''); setErrorMsg('') }, 4000)
  }

  const loadTeam = async () => {
    try {
      const [res, res2] = await Promise.all([
        api.getUsers({ role: 'admin' }),
        api.getUsers({ role: 'instructor' }),
      ])
      const admins = res.data?.users || []
      const instructors = res2.data?.users || []
      setMembers([...admins, ...instructors])
    } catch {
      showNotification('error', 'Failed to load team members')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTeam() }, [])

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)

    const res = await api.createUser({
      email: addEmail.trim().toLowerCase(),
      role: addRole,
      github_username: addGithub.trim() || undefined,
      skip_invite: false,
    })
    if (res.error) {
      showNotification('error', `Failed to add member: ${res.error}`)
    } else {
      showNotification('success', `${addEmail.trim()} added as ${addRole}`)
      setAddEmail('')
      setAddGithub('')
      setShowAddModal(false)
      await loadTeam()
    }
    setAdding(false)
  }

  const startEdit = (member: TeamMember) => {
    setEditingId(member.id)
    setEditDraft({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email,
      role: member.role,
      github_username: member.github_username || '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft(null)
  }

  const saveEdit = async () => {
    if (!editDraft || !editingId) return
    setSaving(true)

    const res = await api.updateUser(editingId, {
      first_name: editDraft.first_name.trim() || undefined,
      last_name: editDraft.last_name.trim() || undefined,
      role: editDraft.role,
      github_username: editDraft.github_username.trim() || undefined,
    })
    if (res.error) {
      showNotification('error', `Failed to save: ${res.error}`)
    } else {
      showNotification('success', 'Team member updated')
      cancelEdit()
      await loadTeam()
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)

    const res = await api.deleteUser(deleteConfirm.id)
    if (res.error) {
      showNotification('error', `Failed to delete: ${res.error}`)
    } else {
      showNotification('success', `${deleteConfirm.email} removed from team`)
      await loadTeam()
    }
    setDeleteConfirm(null)
    setDeleting(false)
  }

  const handleResendInvite = async (member: TeamMember) => {
    setResendingId(member.id)
    const res = await api.resendInvite(member.id)
    if (res.error) {
      showNotification('error', `Failed to resend: ${res.error}`)
    } else {
      showNotification('success', `Invite re-sent to ${member.email}`)
    }
    setResendingId(null)
  }

  const isSelf = (member: TeamMember) => currentUser?.id === member.id
  const isPending = (member: TeamMember) => member.invite_pending

  if (loading) return <LoadingSpinner message="Loading team..." />

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team</h1>
          <p className="text-sm text-slate-500 mt-1">Manage instructors and administrators</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Add Team Member
        </button>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center justify-between">
          {successMsg}
          <button onClick={() => setSuccessMsg('')} className="text-green-600 hover:text-green-800"><X className="h-4 w-4" /></button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center justify-between">
          {errorMsg}
          <button onClick={() => setErrorMsg('')} className="text-red-600 hover:text-red-800"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        {members.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No team members yet. Add an instructor or admin to get started.
          </div>
        ) : (
          members.map((member) => {
            const isEditing = editingId === member.id

            if (isEditing && editDraft) {
              return (
                <div key={member.id} className="p-4 bg-slate-50">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">First Name</label>
                      <input
                        type="text"
                        value={editDraft.first_name}
                        onChange={(e) => setEditDraft({ ...editDraft, first_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Last Name</label>
                      <input
                        type="text"
                        value={editDraft.last_name}
                        onChange={(e) => setEditDraft({ ...editDraft, last_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="Last name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">GitHub Username</label>
                      <input
                        type="text"
                        value={editDraft.github_username}
                        onChange={(e) => setEditDraft({ ...editDraft, github_username: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="e.g., octocat"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Role</label>
                      <select
                        value={editDraft.role}
                        onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="instructor">Instructor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <span className="text-xs text-slate-400 ml-2">{member.email}</span>
                  </div>
                </div>
              )
            }

            return (
              <div key={member.id} className="p-4 flex items-center justify-between gap-4 group hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
                    member.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {member.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {member.full_name}
                      {isSelf(member) && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{member.email}</p>
                    {member.github_username && (
                      <p className="text-xs text-slate-400 truncate">@{member.github_username}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isPending(member) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      <Mail className="h-3 w-3" />
                      Invite sent
                    </span>
                  )}

                  <div className="relative">
                    <select
                      value={member.role}
                      onChange={(e) => {
                        const newRole = e.target.value
                        api.updateUser(member.id, { role: newRole }).then((res) => {
                          if (res.error) {
                            showNotification('error', `Failed to update role: ${res.error}`)
                          }
                          loadTeam()
                        }).catch(() => {
                          showNotification('error', 'Failed to update role — network error')
                          loadTeam()
                        })
                      }}
                      disabled={isSelf(member)}
                      className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-pointer"
                    >
                      <option value="instructor">Instructor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {isPending(member) && (
                    <button
                      onClick={() => handleResendInvite(member)}
                      disabled={resendingId === member.id}
                      title="Resend invite email"
                      className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw className={`h-4 w-4 ${resendingId === member.id ? 'animate-spin' : ''}`} />
                    </button>
                  )}

                  <button
                    onClick={() => startEdit(member)}
                    title="Edit member"
                    className="rounded-lg p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  {!isSelf(member) && (
                    <button
                      onClick={() => setDeleteConfirm(member)}
                      title="Remove from team"
                      className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add Member Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Team Member"
        subtitle="Add an instructor or admin to the platform"
        size="md"
      >
        <form onSubmit={handleAddMember} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address *</label>
            <input
              type="email"
              required
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="instructor@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="instructor">Instructor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">GitHub Username (optional)</label>
            <input
              type="text"
              value={addGithub}
              onChange={(e) => setAddGithub(e.target.value)}
              placeholder="e.g., octocat"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={adding || !addEmail.trim()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding...' : 'Add Member & Send Invite'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Remove Team Member"
        size="md"
      >
        {deleteConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Are you sure you want to remove <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.email}) from the team?
              This will also remove their enrollments and submissions.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
