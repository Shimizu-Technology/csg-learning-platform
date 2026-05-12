import { useEffect, useState } from 'react'
import { Archive, Shield, ShieldCheck, UserPlus, Mail, Pencil, Trash2, RotateCcw, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

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
  archived_at: string | null
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
  const toast = useToast()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active')

  const [showAddModal, setShowAddModal] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('instructor')
  const [addGithub, setAddGithub] = useState('')
  const [adding, setAdding] = useState(false)

  const [editMember, setEditMember] = useState<TeamMember | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<TeamMember | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [resendingId, setResendingId] = useState<number | null>(null)
  const [restoringId, setRestoringId] = useState<number | null>(null)

  const showNotification = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') {
      toast.success(msg)
    } else {
      toast.error(msg)
    }
  }

  const loadTeam = async () => {
    setLoading(true)
    try {
      const params = viewMode === 'archived' ? { include_archived: 'true' } : {}
      const [res, res2] = await Promise.all([
        api.getUsers({ ...params, role: 'admin' }),
        api.getUsers({ ...params, role: 'instructor' }),
      ])
      const admins = res.data?.users || []
      const instructors = res2.data?.users || []
      setMembers(
        [...admins, ...instructors].filter((member) => (
          viewMode === 'archived' ? Boolean(member.archived_at) : !member.archived_at
        ))
      )
    } catch {
      showNotification('error', 'Failed to load team members')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTeam() }, [viewMode])

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

  const openEdit = (member: TeamMember) => {
    setEditMember(member)
    setEditDraft({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email,
      role: member.role,
      github_username: member.github_username || '',
    })
  }

  const closeEdit = () => {
    setEditMember(null)
    setEditDraft(null)
  }

  const saveEdit = async () => {
    if (!editDraft || !editMember) return
    setSaving(true)

    const res = await api.updateUser(editMember.id, {
      first_name: editDraft.first_name.trim() || undefined,
      last_name: editDraft.last_name.trim() || undefined,
      role: editDraft.role,
      github_username: editDraft.github_username.trim() || undefined,
    })
    if (res.error) {
      showNotification('error', `Failed to save: ${res.error}`)
    } else {
      showNotification('success', 'Team member updated')
      closeEdit()
      await loadTeam()
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)

    const res = await api.deleteUser(deleteConfirm.id)
    if (res.error) {
      showNotification('error', `Failed to ${deleteConfirm.invite_pending ? 'delete invite' : 'archive user'}: ${res.error}`)
    } else {
      showNotification('success', res.data?.action === 'deleted' ? `${deleteConfirm.email} invite deleted` : `${deleteConfirm.email} archived`)
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

  const handleRestore = async (member: TeamMember) => {
    setRestoringId(member.id)
    const res = await api.unarchiveUser(member.id)
    if (res.error) {
      showNotification('error', `Failed to restore: ${res.error}`)
    } else {
      showNotification('success', member.invite_pending ? `${member.email} restored and invite sent` : `${member.email} restored`)
      await loadTeam()
    }
    setRestoringId(null)
  }

  const isSelf = (member: TeamMember) => currentUser?.id === member.id
  const isPending = (member: TeamMember) => member.invite_pending
  const isArchived = (member: TeamMember) => Boolean(member.archived_at)

  if (loading) return <LoadingSpinner message="Loading team..." />

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team</h1>
          <p className="text-sm text-slate-500 mt-1">Manage instructors and administrators</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 transition-colors shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Team Member</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setViewMode('active')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            viewMode === 'active' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setViewMode('archived')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            viewMode === 'archived' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Archived
        </button>
      </div>

      <div className="space-y-3">
        {members.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            {viewMode === 'archived' ? 'No archived team members.' : 'No team members yet. Add an instructor or admin to get started.'}
          </div>
        ) : (
          members.map((member) => (
            <div key={member.id} className={`rounded-xl bg-white border p-4 transition-colors ${
              isArchived(member) ? 'border-slate-200 opacity-80' : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
                  isArchived(member)
                    ? 'bg-slate-100 text-slate-500'
                    : member.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {member.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">{member.full_name}</p>
                    {isSelf(member) && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">you</span>
                    )}
                    {isArchived(member) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        <Archive className="h-3 w-3" />
                        Archived
                      </span>
                    )}
                    {isPending(member) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        <Mail className="h-3 w-3" />
                        Invite sent
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      member.role === 'admin'
                        ? 'bg-primary-50 text-primary-700'
                        : 'bg-blue-50 text-blue-700'
                    }`}>
                      {member.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{member.email}</p>
                  {member.github_username && (
                    <p className="text-xs text-slate-400 truncate">@{member.github_username}</p>
                  )}
                </div>
              </div>

              {/* Actions — always visible, stacked below on mobile */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                {isArchived(member) ? (
                  <button
                    onClick={() => handleRestore(member)}
                    disabled={restoringId === member.id}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${restoringId === member.id ? 'animate-spin' : ''}`} />
                    Restore
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => openEdit(member)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>

                    {isPending(member) && (
                      <button
                        onClick={() => handleResendInvite(member)}
                        disabled={resendingId === member.id}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${resendingId === member.id ? 'animate-spin' : ''}`} />
                        Resend
                      </button>
                    )}

                    <div className="flex-1" />

                    {!isSelf(member) && (
                      <button
                        onClick={() => setDeleteConfirm(member)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        {isPending(member) ? <Trash2 className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        {isPending(member) ? 'Delete invite' : 'Archive'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Member Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Team Member"
        subtitle="Send an invite to a new instructor or admin"
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
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={adding || !addEmail.trim()}
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding...' : 'Add & Send Invite'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Member Modal */}
      <Modal
        open={!!editMember}
        onClose={closeEdit}
        title="Edit Team Member"
        subtitle={editMember?.email}
        size="md"
      >
        {editDraft && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                <input
                  type="text"
                  value={editDraft.first_name}
                  onChange={(e) => setEditDraft({ ...editDraft, first_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                <input
                  type="text"
                  value={editDraft.last_name}
                  onChange={(e) => setEditDraft({ ...editDraft, last_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Last name"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">GitHub Username</label>
              <input
                type="text"
                value={editDraft.github_username}
                onChange={(e) => setEditDraft({ ...editDraft, github_username: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="e.g., octocat"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={editDraft.role}
                onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="instructor">Instructor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                <Check className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={closeEdit}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title={deleteConfirm?.invite_pending ? 'Delete Pending Invite' : 'Archive Team Member'}
        size="md"
      >
        {deleteConfirm && (
          <div className="space-y-4">
            {deleteConfirm.invite_pending ? (
              <p className="text-sm text-slate-600">
                Delete the pending invite for <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.email})? This is only for unused invitations.
              </p>
            ) : (
              <p className="text-sm text-slate-600">
                Archive <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.email})? They will no longer appear in team or messaging pickers, and their sign-in will be disabled. Existing messages and records will remain intact.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? (deleteConfirm.invite_pending ? 'Deleting...' : 'Archiving...') : (deleteConfirm.invite_pending ? 'Delete Invite' : 'Archive Member')}
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
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
