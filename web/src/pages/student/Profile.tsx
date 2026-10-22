import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, ChevronRight, FileText, Github, LogOut, Mail, Save, ShieldCheck, Trash2, UserCog, UserX } from 'lucide-react'
import { useClerk } from '@clerk/clerk-react'
import { api } from '../../lib/api'
import { loadFailureMessage, unavailableResponse } from '../../lib/loadFailure'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
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

const ENROLLMENT_TONES: Record<string, BadgeTone> = { active: 'success', completed: 'info' }

export function Profile() {
  const toast = useToast()
  const confirmAction = useConfirm()
  const { openUserProfile, signOut } = useClerk()
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const profileRequest = useRef(0)
  const githubEdited = useRef(false)
  const profileLoaded = useRef(false)
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

  const loadProfile = useCallback(async () => {
    const request = ++profileRequest.current
    if (!profileLoaded.current) setLoading(true)
    setLoadError(null)
    try {
      const res = await api.getProfile()
      if (request !== profileRequest.current) return
      if (unavailableResponse(res) || res.errorKind === 'auth' || res.status === 401) {
        setData(null)
        setLoadError(loadFailureMessage('Profile', res))
      } else if (res.data) {
        profileLoaded.current = true
        setData(res.data)
        if (!githubEdited.current) setGithubUsername(res.data.user.github_username || '')
        setLoadError(res.fromCache ? 'Showing your saved profile. Reconnect and retry for current account information.' : null)
      } else setLoadError(loadFailureMessage('Profile', res))
    } catch {
      if (request === profileRequest.current) setLoadError(loadFailureMessage('Profile', {}))
    } finally {
      if (request === profileRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void loadProfile(); return () => { profileRequest.current += 1 } }, [loadProfile])
  useEffect(() => {
    loadNotificationPreference()
    api.getBlockedUsers().then((res) => { if (res.data) setBlockedUsers(res.data.blocked_users) })
  }, [loadNotificationPreference])

  const handleSave = async () => {
    setSaving(true)
    const res = await api.updateProfile({ github_username: githubUsername })
    if (!res.error) {
      githubEdited.current = false
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
  if (!data) return <div className="app-page max-w-2xl"><h1 className="app-title">Profile</h1><p role="alert" className="text-ink-secondary">{loadError || 'Could not load your profile.'}</p><Button onClick={() => void loadProfile()}>Try again</Button></div>

  return (
    <div className="app-page max-w-2xl">
      <header>
        <p className="app-eyebrow">Account & preferences</p>
        <h1 className="app-title mt-2">Profile</h1>
        <p className="app-description mt-2">Keep your class identity and connected accounts up to date.</p>
      </header>

      {loadError && <div role="alert" className="rounded-2xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800"><p>{loadError}</p><Button variant="secondary" onClick={() => void loadProfile()}>Try again</Button></div>}
      {/* User info */}
      <div className="app-surface space-y-4 p-6">
        <div className="flex items-center gap-4">
          <Avatar name={data.user.full_name || `${data.user.first_name} ${data.user.last_name}`} src={data.user.avatar_url} size="lg" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-ink [overflow-wrap:anywhere]">{data.user.full_name}</h2>
            <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{data.user.email}</p>
          </div>
        </div>

        {/* GitHub username */}
        <div>
          <label htmlFor="profile-github-username" className="mb-1 flex items-center gap-1 text-sm font-medium text-ink-secondary">
            <Github className="h-4 w-4 shrink-0" aria-hidden="true" />
            GitHub username
          </label>
          <div className="flex gap-2">
            <input
              id="profile-github-username"
              type="text"
              value={githubUsername}
              onChange={(e) => { githubEdited.current = true; setGithubUsername(e.target.value) }}
              placeholder="Enter your GitHub username"
              className="app-control min-w-0 flex-1"
            />
            <Button onClick={handleSave} disabled={saving}>
              {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
          <p className="text-sm font-medium text-ink">Account session</p>
          <p className="mt-1 text-sm text-ink-secondary">Manage your sign-in details, or sign out on this device.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openUserProfile()}>
              <UserCog className="h-4 w-4" aria-hidden="true" />
              Manage account
            </Button>
            <Button variant="quiet" onClick={() => void signOut({ redirectUrl: '/sign-in' })}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight text-ink">Notifications</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">Choose how class conversations reach you when you are away from the app.</p>
        </div>
        <div className="flex items-start justify-between gap-5 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Mail className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Direct-message emails</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-ink-secondary">Receive an email when someone sends you a direct message. Browser alerts are controlled separately from Messages or Updates.</p>
            </div>
          </div>
          {emailNotificationsEnabled === null ? (
            notificationPreferenceError ? (
              <Button variant="secondary" size="sm" onClick={loadNotificationPreference} className="shrink-0">
                Retry
              </Button>
            ) : (
              <span role="status" className="min-h-11 shrink-0 px-2 py-3 text-xs font-semibold text-ink-muted">Loading…</span>
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
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-out before:absolute before:-inset-2 before:content-[''] disabled:opacity-50 ${emailNotificationsEnabled ? 'bg-ink' : 'bg-slate-200 ring-1 ring-inset ring-slate-500'}`}
            >
              <span className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${emailNotificationsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          )}
        </div>
      </section>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight text-ink">Privacy & safety</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">Review how your data is handled and control your account.</p>
        </div>
        <Link to="/privacy" className="pressable flex min-h-16 items-center gap-3 border-b border-line px-5 py-4 hover:bg-surface-sunken sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Privacy policy</span><span className="mt-1 block text-xs leading-5 text-ink-secondary">How CSG Learn handles account and learning data.</span></span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        </Link>
        <Link to="/terms" className="pressable flex min-h-16 items-center gap-3 border-b border-line px-5 py-4 hover:bg-surface-sunken sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><FileText className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Terms & Community Guidelines</span><span className="mt-1 block text-xs leading-5 text-ink-secondary">Rules that keep class conversations safe.</span></span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        </Link>
        {blockedUsers.length > 0 && <div className="border-b border-line px-5 py-4 sm:px-6">
          <div className="mb-3 flex items-center gap-2"><UserX className="h-4 w-4 text-ink-muted" aria-hidden="true" /><h3 className="text-sm font-bold text-ink">Blocked users</h3></div>
          <div className="space-y-2">{blockedUsers.map((blockedUser) => <div key={blockedUser.id} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-surface-sunken px-3 py-2"><span className="flex min-w-0 items-center gap-2"><Avatar name={blockedUser.full_name} size="sm" /><span className="min-w-0 truncate text-sm font-semibold text-ink">{blockedUser.full_name}</span></span><Button variant="secondary" size="sm" onClick={() => void unblockUser(blockedUser)}>Unblock</Button></div>)}</div>
        </div>}
        <button type="button" disabled={requestingDeletion || deletionRequested} onClick={() => void requestAccountDeletion()} className="pressable flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left hover:bg-danger-50 disabled:cursor-default disabled:opacity-65 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-700"><Trash2 className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-danger-700">{deletionRequested ? 'Deletion request received' : 'Request account deletion'}</span><span className="mt-1 block text-xs leading-5 text-ink-secondary">Ask the Code School team to delete your account and eligible data.</span></span>
          {!deletionRequested && <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />}
        </button>
      </section>

      {/* Enrollments */}
      <ActivityTimeline />
      <div className="app-surface p-6">
        <h3 className="mb-4 text-lg font-semibold text-ink">Enrollments</h3>
        {data.enrollments.length === 0 ? (
          <p className="text-sm text-ink-secondary">No enrollments yet.</p>
        ) : (
          <div className="space-y-3">
            {data.enrollments.map((enrollment) => (
              <div key={enrollment.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-sunken p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{enrollment.cohort_name}</p>
                  <p className="text-xs text-ink-secondary [overflow-wrap:anywhere]">{enrollment.curriculum_name}</p>
                </div>
                <Badge tone={ENROLLMENT_TONES[enrollment.status] || 'neutral'}>{enrollment.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
