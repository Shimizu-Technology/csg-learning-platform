import { useEffect, useState } from 'react'
import { Bell, Check, Github, Mail, Save } from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useToast } from '../../contexts/ToastContext'

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
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [githubUsername, setGithubUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<boolean | null>(null)
  const [savingNotifications, setSavingNotifications] = useState(false)

  useEffect(() => {
    api.getProfile().then((res) => {
      if (res.data) {
        setData(res.data)
        setGithubUsername(res.data.user.github_username || '')
      }
      setLoading(false)
    })
    api.getPushConfig().then((res) => {
      if (typeof res.data?.notifications_enabled === 'boolean') {
        setEmailNotificationsEnabled(res.data.notifications_enabled)
      }
    })
  }, [])

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
              <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Receive an email when someone sends you a direct message. Browser push settings are managed separately on each device.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(emailNotificationsEnabled)}
            aria-label="Direct-message email notifications"
            onClick={toggleEmailNotifications}
            disabled={emailNotificationsEnabled === null || savingNotifications}
            className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-50 ${emailNotificationsEnabled ? 'bg-primary-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${emailNotificationsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
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
