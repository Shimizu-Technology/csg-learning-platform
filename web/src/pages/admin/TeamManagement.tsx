import { useEffect, useState } from 'react'
import { Shield, ShieldCheck, UserPlus, Mail, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'

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
  created_at: string
}

export function TeamManagement() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('instructor')
  const [addGithub, setAddGithub] = useState('')
  const [adding, setAdding] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const loadTeam = async () => {
    const res = await api.getUsers({ role: 'admin' })
    const admins = res.data?.users || []
    const res2 = await api.getUsers({ role: 'instructor' })
    const instructors = res2.data?.users || []
    setMembers([...admins, ...instructors])
    setLoading(false)
  }

  useEffect(() => { loadTeam() }, [])

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setMessage('')

    const res = await api.createUser({
      email: addEmail.trim().toLowerCase(),
      role: addRole,
      github_username: addGithub.trim() || undefined,
      skip_invite: false,
    })
    if (res.error) {
      setMessage(`Error: ${res.error}`)
    } else {
      setMessage(`Added ${addEmail.trim()} as ${addRole}`)
      setAddEmail('')
      setAddGithub('')
      setShowAddModal(false)
      await loadTeam()
    }
    setAdding(false)
  }

  const handleRoleChange = async (userId: number, newRole: string) => {
    setUpdatingId(userId)
    setMessage('')
    const res = await api.updateUser(userId, { role: newRole })
    if (res.error) {
      setMessage(`Failed to update role: ${res.error}`)
    } else {
      setMessage('Role updated')
      await loadTeam()
    }
    setUpdatingId(null)
  }

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

      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        {members.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No team members yet. Add an instructor or admin to get started.
          </div>
        ) : (
          members.map((member) => {
            const isPending = !member.last_sign_in_at
            return (
              <div key={member.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
                    member.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {member.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{member.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{member.email}</p>
                    {member.github_username && (
                      <p className="text-xs text-slate-400 truncate">@{member.github_username}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {isPending && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      <Mail className="h-3 w-3" />
                      Invite sent
                    </span>
                  )}
                  <div className="relative">
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.id, e.target.value)}
                      disabled={updatingId === member.id}
                      className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-pointer"
                    >
                      <option value="instructor">Instructor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

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
              {adding ? 'Adding...' : 'Add Member'}
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
    </div>
  )
}
