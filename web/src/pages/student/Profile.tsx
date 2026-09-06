import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, ChevronRight, FileText, Github, Mail, Save, ShieldCheck, Trash2, UserX } from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import type { BlockedUser } from '../../types/api'

interface ProfileData {
  user: {
    id: number
    email: string
    first_name: string
    last_name: string
    full_name: string
    github_username: string | null
    avatar_url: string | null
  }
  enrollments: Array<{
    id: number
    cohort_name: string
    curriculum_name: string
    status: string
    enrolled_at: string | null
  }>
}

export function Profile() {
  const toast = useToast()
  const confirmAction = useConfirm()
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [githubUsername, setGithubUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<boolean | null>(null)
  const [notificationPreferenceError, setNotificationPreferenceError] = useState<string | null>(null)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [requestingDeletion, setRequestingDeletion] = useState(false)
  const [deletionRequested, setDeletionRequested] = useState(false)
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])

  const loadNotificationPreference = useCallback(async () => {
    setEmailNotificationsEnabled(null)
    setNotificationPreferenceError(null)
    const response = await api.getPushConfig()
    if (typeof response.data?.notifications_enabled === 'boolean') {
      setEmailNotificationsEnabled(response.data.notifications_enabled)
    } else {
      setNotificationPreferenceError(response.error || 'Could not load this preference')
    }
  }, [])

  useEffect(() => {
    api.getProfile().then((res) => {
      if (res.data) {
        setData(res.data)
        setGithubUsername(res.data.user.github_username || '')
      }
      setLoading(false)
    })
    loadNotificationPreference()
    api.getBlockedUsers().then((res) => { if (res.data) setBlockedUsers(res.data.blocked_users) })
  }, [loadNotificationPreference])

  const handleSave = async () => {
    setSaving(true)
    const res = await api.updateProfile({ github_username: githubUsername })
    if (!res.error) {
      setSaved(true)
      toast.success('Profile saved')
      setTimeout(() => setSaved(false), 2000)
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  const toggleEmailNotifications = async () => {
    if (emailNotificationsEnabled === null || savingNotifications) return

    const next = !emailNotificationsEnabled
    setSavingNotifications(true)
    const response = await api.updateMessageNotifications(next)
    if (response.data) {
      setEmailNotificationsEnabled(response.data.notifications_enabled)
      toast.success(response.data.notifications_enabled ? 'Message emails turned on' : 'Message emails turned off')
    } else {
      toast.error(response.error || 'Could not update notification preferences')
    }
    setSavingNotifications(false)
  }

  const requestAccountDeletion = async () => {
    const confirmed = await confirmAction({
      title: 'Request account deletion?',
      description: 'This sends a request to the Code School team. Your account and class records will not be deleted immediately.',
      confirmLabel: 'Send request',
      tone: 'danger',
    })
    if (!confirmed) return

    setRequestingDeletion(true)
    const result = await api.requestDataDeletion()
    setRequestingDeletion(false)
    if (!result.data) return toast.error(result.error || 'Could not submit your deletion request.')
    setDeletionRequested(true)
    toast.success('Deletion request received. The Code School team will follow up with you.')
  }

  const unblockUser = async (blockedUser: BlockedUser) => {
    const result = await api.unblockUser(blockedUser.id)
    if (result.error) return toast.error(result.error)
    setBlockedUsers((current) => current.filter((item) => item.id !== blockedUser.id))
    toast.success(`${blockedUser.full_name} was unblocked.`)
  }

  if (loading) return <LoadingSpinner message="Loading profile..." />
  if (!data) return null

  return (
    <div className="app-page max-w-2xl">
      <header>
        <p className="app-eyebrow">Account & preferences</p>
        <h1 className="app-title mt-2">Profile</h1>
        <p className="app-description mt-2">Keep your class identity and connected accounts up to date.</p>
      </header>

      {/* User info */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xl font-bold">
            {data.user.first_name?.[0]}{data.user.last_name?.[0]}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{data.user.full_name}</h2>
            <p className="text-sm text-slate-500">{data.user.email}</p>
          </div>
        </div>

        {/* GitHub username */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            <Github className="inline h-4 w-4 mr-1" />
            GitHub Username
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={githubUsername}
              onChange={(e) => setGithubUsername(e.target.value)}
              placeholder="Enter your GitHub username"
              className="app-control min-w-0 flex-1"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-medium text-slate-900">Account session</p>
          <p className="mt-1 text-sm text-slate-500">Open the account menu here to sign out on mobile or switch accounts.</p>
          <div className="mt-3">
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox: 'h-10 w-10',
                }
              }}
            />
          </div>
        </div>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary-600" />
            <h2 className="text-lg font-extrabold tracking-tight text-slate-950">Notifications</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Choose how class conversations reach you when you are away from the app.</p>
        </div>
        <div className="flex items-start justify-between gap-5 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Mail className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-extrabold text-slate-950">Direct-message emails</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Receive an email when someone sends you a direct message. Browser alerts are controlled separately from Messages or Updates.</p>
            </div>
          </div>
          {emailNotificationsEnabled === null ? (
            notificationPreferenceError ? (
              <button type="button" onClick={loadNotificationPreference} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold text-primary-700 hover:bg-primary-50">
                Retry
              </button>
            ) : (
              <span role="status" className="min-h-11 shrink-0 px-2 py-3 text-xs font-semibold text-slate-500">Loading…</span>
            )
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={emailNotificationsEnabled}
              aria-label="Direct-message email notifications"
              aria-busy={savingNotifications}
              onClick={toggleEmailNotifications}
              disabled={savingNotifications}
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-50 ${emailNotificationsEnabled ? 'bg-primary-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${emailNotificationsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          )}
        </div>
      </section>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <h2 className="text-lg font-extrabold tracking-tight text-slate-950">Privacy & safety</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Review how your data is handled and control your account.</p>
        </div>
        <Link to="/privacy" className="flex min-h-16 items-center gap-3 border-b border-slate-200/80 px-5 py-4 transition hover:bg-slate-50 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><ShieldCheck className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-950">Privacy policy</span><span className="mt-1 block text-xs leading-5 text-slate-500">How CSG Connect handles account and learning data.</span></span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
        <Link to="/terms" className="flex min-h-16 items-center gap-3 border-b border-slate-200/80 px-5 py-4 transition hover:bg-slate-50 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><FileText className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-950">Terms & Community Guidelines</span><span className="mt-1 block text-xs leading-5 text-slate-500">Rules that keep class conversations safe.</span></span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
        {blockedUsers.length > 0 && <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
          <div className="mb-3 flex items-center gap-2"><UserX className="h-4 w-4 text-primary-600" /><h3 className="text-sm font-extrabold text-slate-950">Blocked users</h3></div>
          <div className="space-y-2">{blockedUsers.map((blockedUser) => <div key={blockedUser.id} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"><span className="min-w-0 truncate text-sm font-bold text-slate-800">{blockedUser.full_name}</span><button type="button" onClick={() => void unblockUser(blockedUser)} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-extrabold text-primary-700 hover:bg-primary-50">Unblock</button></div>)}</div>
        </div>}
        <button type="button" disabled={requestingDeletion || deletionRequested} onClick={() => void requestAccountDeletion()} className="flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-red-50 disabled:cursor-default disabled:opacity-65 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700"><Trash2 className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-red-800">{deletionRequested ? 'Deletion request received' : 'Request account deletion'}</span><span className="mt-1 block text-xs leading-5 text-slate-500">Ask the Code School team to delete your account and eligible data.</span></span>
          {!deletionRequested && <ChevronRight className="h-5 w-5 text-slate-400" />}
        </button>
      </section>

      {/* Enrollments */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Enrollments</h3>
        {data.enrollments.length === 0 ? (
          <p className="text-sm text-slate-500">No enrollments yet.</p>
        ) : (
          <div className="space-y-3">
            {data.enrollments.map((enrollment) => (
              <div key={enrollment.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{enrollment.cohort_name}</p>
                  <p className="text-xs text-slate-500">{enrollment.curriculum_name}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  enrollment.status === 'active' ? 'bg-success-100 text-success-700' :
                  enrollment.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {enrollment.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
