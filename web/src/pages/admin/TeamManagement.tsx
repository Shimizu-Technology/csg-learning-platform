import { useEffect, useId, useRef, useState } from 'react'
import { Activity, Archive, UserPlus, Mail, Pencil, Trash2, RotateCcw, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { Modal } from '../../components/shared/Modal'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  instructor: 'Instructor',
}

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
  const fieldIdBase = useId()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active')
  const loadRequestId = useRef(0)

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
  const [restoreConfirm, setRestoreConfirm] = useState<TeamMember | null>(null)
  const [activityMember, setActivityMember] = useState<TeamMember | null>(null)

  const [resendingId, setResendingId] = useState<number | null>(null)
  const [restoringId, setRestoringId] = useState<number | null>(null)

  const showNotification = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') {
      toast.success(msg)
    } else {
      toast.error(msg)
    }
  }

  const loadTeam = async (mode: 'active' | 'archived' = viewMode) => {
    const requestId = loadRequestId.current + 1
    loadRequestId.current = requestId
    setListLoading(true)
    try {
      const params: Record<string, string> = mode === 'archived' ? { include_archived: 'true' } : {}
      const [res, res2] = await Promise.all([
        api.getUsers({ ...params, role: 'admin' }),
        api.getUsers({ ...params, role: 'instructor' }),
      ])
      if (loadRequestId.current !== requestId) return

      const admins = res.data?.users || []
      const instructors = res2.data?.users || []
      setMembers(
        [...admins, ...instructors].filter((member) => (
          mode === 'archived' ? Boolean(member.archived_at) : !member.archived_at
        ))
      )
    } catch {
      if (loadRequestId.current !== requestId) return

      showNotification('error', 'Failed to load team members')
    } finally {
      if (loadRequestId.current === requestId) {
        setListLoading(false)
      }
    }
  }

  useEffect(() => { loadTeam(viewMode) }, [viewMode])

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
      showNotification('success', `Invite queued for ${member.email}`)
    }
    setResendingId(null)
  }

  const handleRestore = async () => {
    if (!restoreConfirm) return
    const member = restoreConfirm
    setRestoringId(member.id)
    const res = await api.unarchiveUser(member.id)
    if (res.error) {
      showNotification('error', `Failed to restore: ${res.error}`)
    } else {
      const inviteFailed = res.data?.invitation?.status === 'failed'
      showNotification(inviteFailed ? 'error' : 'success', inviteFailed ? `${member.email} was restored, but the invite needs to be retried` : res.data?.message || `${member.email} restored`)
      await loadTeam()
    }
    setRestoreConfirm(null)
    setRestoringId(null)
  }

  const isSelf = (member: TeamMember) => currentUser?.id === member.id
  const isPending = (member: TeamMember) => member.invite_pending
  const isArchived = (member: TeamMember) => Boolean(member.archived_at)

  return (
    <div className="app-page max-w-4xl">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="app-eyebrow">Access & ownership</p>
          <h1 className="app-title mt-2">Team</h1>
          <p className="app-description mt-2">Manage instructors and administrators.</p>
        </div>
        <Button onClick={() => setShowAddModal(true)} className="shrink-0">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add Team Member</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </header>

      <SegmentedControl label="Team members view" className="self-start">
        <SegmentButton dense selected={viewMode === 'active'} onClick={() => setViewMode('active')}>
          Active
        </SegmentButton>
        <SegmentButton dense selected={viewMode === 'archived'} onClick={() => setViewMode('archived')}>
          Archived
        </SegmentButton>
      </SegmentedControl>

      <div className="space-y-3">
        {listLoading ? (
          <TeamListSkeleton />
        ) : members.length === 0 ? (
          <div className="app-surface p-8 text-center text-sm text-ink-muted">
            {viewMode === 'archived' ? 'No archived team members.' : 'No team members yet. Add an instructor or admin to get started.'}
          </div>
        ) : (
          members.map((member) => (
            <div key={member.id} className={`app-surface p-4 ${isArchived(member) ? 'opacity-80' : ''}`}>
              <div className="flex items-start gap-3">
                <Avatar name={member.full_name} src={member.avatar_url} size="md" />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="min-w-0 max-w-full truncate text-sm font-semibold text-ink" title={member.full_name}>{member.full_name}</p>
                    {isSelf(member) && (
                      <Badge>You</Badge>
                    )}
                    {isArchived(member) && (
                      <Badge icon={<Archive className="h-3 w-3" aria-hidden="true" />}>Archived</Badge>
                    )}
                    {isPending(member) && (
                      <Badge tone="pending" icon={<Mail className="h-3 w-3" aria-hidden="true" />}>Invite sent</Badge>
                    )}
                    <Badge>{ROLE_LABELS[member.role] || member.role}</Badge>
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5 truncate" title={member.email}>{member.email}</p>
                  {member.github_username && (
                    <p className="text-xs text-ink-muted truncate" title={`@${member.github_username}`}>@{member.github_username}</p>
                  )}
                </div>
              </div>

              {/* Actions — always visible, stacked below on mobile */}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
                <Button variant="quiet" size="sm" onClick={() => setActivityMember(member)}><Activity className="h-4 w-4" aria-hidden="true" />Activity</Button>
                {isArchived(member) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setRestoreConfirm(member)}
                    disabled={restoringId === member.id}
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${restoringId === member.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(member)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>

                    {isPending(member) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleResendInvite(member)}
                        disabled={resendingId === member.id}
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${resendingId === member.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                        Resend
                      </Button>
                    )}

                    <div className="flex-1" />

                    {!isSelf(member) && (
                      <Button variant="danger" size="sm" className="shrink-0" onClick={() => setDeleteConfirm(member)}>
                        {isPending(member) ? <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                        {isPending(member) ? 'Delete invite' : 'Archive'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Member Modal */}
      <Modal open={Boolean(activityMember)} onClose={() => setActivityMember(null)} title={activityMember ? `${activityMember.full_name} activity` : 'Activity'} size="lg">
        {activityMember && <ActivityTimeline key={activityMember.id} userId={activityMember.id} />}
      </Modal>
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Team Member"
        subtitle="Send an invite to a new instructor or admin"
        size="md"
      >
        <form onSubmit={handleAddMember} className="space-y-4">
          <div>
            <label htmlFor={`${fieldIdBase}-add-email`} className="block text-sm font-medium text-ink-secondary mb-1">Email Address *</label>
            <input
              id={`${fieldIdBase}-add-email`}
              type="email"
              required
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="instructor@example.com"
              className="app-control w-full"
            />
          </div>
          <div>
            <label htmlFor={`${fieldIdBase}-add-role`} className="block text-sm font-medium text-ink-secondary mb-1">Role</label>
            <select
              id={`${fieldIdBase}-add-role`}
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="app-control w-full"
            >
              <option value="instructor">Instructor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldIdBase}-add-github`} className="block text-sm font-medium text-ink-secondary mb-1">GitHub Username (optional)</label>
            <input
              id={`${fieldIdBase}-add-github`}
              type="text"
              value={addGithub}
              onChange={(e) => setAddGithub(e.target.value)}
              placeholder="e.g., octocat"
              className="app-control w-full"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={adding || !addEmail.trim()}
              className="flex-1"
            >
              {adding ? 'Adding...' : 'Add & Send Invite'}
            </Button>
            <Button variant="quiet" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
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
                <label htmlFor={`${fieldIdBase}-edit-first-name`} className="block text-sm font-medium text-ink-secondary mb-1">First Name</label>
                <input
                  id={`${fieldIdBase}-edit-first-name`}
                  type="text"
                  value={editDraft.first_name}
                  onChange={(e) => setEditDraft({ ...editDraft, first_name: e.target.value })}
                  className="app-control w-full"
                  placeholder="First name"
                />
              </div>
              <div>
                <label htmlFor={`${fieldIdBase}-edit-last-name`} className="block text-sm font-medium text-ink-secondary mb-1">Last Name</label>
                <input
                  id={`${fieldIdBase}-edit-last-name`}
                  type="text"
                  value={editDraft.last_name}
                  onChange={(e) => setEditDraft({ ...editDraft, last_name: e.target.value })}
                  className="app-control w-full"
                  placeholder="Last name"
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${fieldIdBase}-edit-github`} className="block text-sm font-medium text-ink-secondary mb-1">GitHub Username</label>
              <input
                id={`${fieldIdBase}-edit-github`}
                type="text"
                value={editDraft.github_username}
                onChange={(e) => setEditDraft({ ...editDraft, github_username: e.target.value })}
                className="app-control w-full"
                placeholder="e.g., octocat"
              />
            </div>
            <div>
              <label htmlFor={`${fieldIdBase}-edit-role`} className="block text-sm font-medium text-ink-secondary mb-1">Role</label>
              <select
                id={`${fieldIdBase}-edit-role`}
                value={editDraft.role}
                onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })}
                className="app-control w-full"
              >
                <option value="instructor">Instructor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={saveEdit} disabled={saving} className="flex-1">
                <Check className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant="quiet" onClick={closeEdit}>
                Cancel
              </Button>
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
              <p className="text-sm text-ink-secondary">
                Delete the pending invite for <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.email})? This is only for unused invitations.
              </p>
            ) : (
              <p className="text-sm text-ink-secondary">
                Archive <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.email})? They will no longer appear in team or messaging pickers, and their sign-in will be disabled. Existing messages and records will remain intact.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="danger" onClick={handleDelete} disabled={deleting} className="flex-1">
                {deleting ? (deleteConfirm.invite_pending ? 'Deleting...' : 'Archiving...') : (deleteConfirm.invite_pending ? 'Delete Invite' : 'Archive Member')}
              </Button>
              <Button variant="quiet" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal
        open={!!restoreConfirm}
        onClose={() => setRestoreConfirm(null)}
        title="Restore Team Member"
        size="md"
      >
        {restoreConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              Restore <strong>{restoreConfirm.full_name}</strong> ({restoreConfirm.email})? They will appear in active team and messaging pickers again. Archived direct conversations stay archived for history.
            </p>
            {restoreConfirm.invite_pending && (
              <p className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800">
                This account is still pending, so a fresh invite email will be sent.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={handleRestore} disabled={restoringId === restoreConfirm.id} className="flex-1">
                {restoringId === restoreConfirm.id ? 'Restoring...' : 'Restore Member'}
              </Button>
              <Button variant="quiet" onClick={() => setRestoreConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function TeamListSkeleton() {
  return (
    <>
      {[0, 1].map((item) => (
        <div key={item} className="app-surface p-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-44 animate-pulse rounded-full bg-slate-200" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded-full bg-slate-100" />
            </div>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="h-11 w-24 animate-pulse rounded-xl bg-slate-100 lg:h-9" />
          </div>
        </div>
      ))}
    </>
  )
}
