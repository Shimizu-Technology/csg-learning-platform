import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Check, Megaphone, Pin, Send } from 'lucide-react'
import { api } from '../../lib/api'
import { disablePushNotifications, enablePushNotifications, pushSupported } from '../../lib/pushNotifications'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { Announcement, CohortSummary } from '../../types/api'

function formatDate(date?: string | null) {
  if (!date) return 'Draft'
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Announcements() {
  const { id } = useParams()
  const selectedId = id ? Number(id) : null
  const { user } = useAuthContext()
  const isStaff = Boolean(user?.is_staff)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    title: '',
    body: '',
    audience: 'cohort',
    cohort_id: '',
    pinned: false,
    send_push: true,
  })

  const selected = useMemo(
    () => announcements.find((announcement) => announcement.id === selectedId) || null,
    [announcements, selectedId],
  )

  const loadAnnouncements = async () => {
    const res = await api.getAnnouncements(isStaff ? 'manage' : undefined)
    if (res.data) {
      setAnnouncements(res.data.announcements)
      setUnreadCount(res.data.unread_count)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadAnnouncements()
    if (isStaff) {
      api.getCohorts().then((res) => {
        if (res.data) {
          const nextCohorts = res.data.cohorts
          setCohorts(nextCohorts)
          setForm((prev) => ({ ...prev, cohort_id: String(nextCohorts[0]?.id || '') }))
        }
      })
    }
  }, [isStaff])

  useEffect(() => {
    if (!pushSupported()) return

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
      .catch(() => setPushEnabled(false))
  }, [])

  useEffect(() => {
    if (!selectedId) return

    api.getAnnouncement(selectedId).then((res) => {
      if (res.data) {
        setAnnouncements((prev) => {
          const exists = prev.some((announcement) => announcement.id === res.data!.announcement.id)
          if (exists) {
            return prev.map((announcement) => announcement.id === res.data!.announcement.id ? res.data!.announcement : announcement)
          }
          return [res.data!.announcement, ...prev]
        })
        api.getNotifications(1).then((notificationsRes) => {
          if (notificationsRes.data) setUnreadCount(notificationsRes.data.unread_count)
        })
      }
    })
  }, [selectedId])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFormError('')

    const audience = form.audience
    const res = await api.createAnnouncement({
      title: form.title.trim(),
      body: form.body.trim(),
      audience,
      cohort_id: audience === 'cohort' ? Number(form.cohort_id) : null,
      status: 'published',
      pinned: form.pinned,
      send_push: form.send_push,
    })

    if (res.error) {
      setFormError(res.error)
    } else if (res.data) {
      setForm((prev) => ({ ...prev, title: '', body: '', pinned: false }))
      await loadAnnouncements()
    }
    setSaving(false)
  }

  const handleMarkAllRead = async () => {
    const res = await api.markAllNotificationsRead()
    if (res.data) {
      setUnreadCount(res.data.unread_count)
      setAnnouncements((prev) => prev.map((announcement) => ({ ...announcement, read_at: announcement.read_at || new Date().toISOString() })))
    }
  }

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Class notifications are off for this device.')
      } catch (error) {
        setPushMessage(error instanceof Error ? error.message : 'Could not turn off notifications.')
      }
      return
    }

    const config = await api.getPushConfig()
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!config.data?.configured && !publicKey) {
      setPushMessage('Push notifications are not configured yet.')
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Class notifications are on for this device.')
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'Could not enable notifications.')
    }
  }

  if (loading) return <LoadingSpinner message="Loading announcements..." />

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary-600">Communication</p>
          <h1 className="text-2xl font-semibold text-slate-900">Announcements</h1>
          <p className="mt-1 text-sm text-slate-500">Class updates, pinned notices, and important CSG messages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Check className="h-4 w-4" />
              Mark all read
            </button>
          )}
          {pushSupported() && (
            <button
              onClick={handleTogglePush}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              {pushEnabled ? 'Turn off push' : 'Turn on push'}
            </button>
          )}
        </div>
      </div>

      {pushMessage && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          {pushMessage}
        </div>
      )}

      {isStaff && (
        <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary-500" />
            <h2 className="font-semibold text-slate-900">Post an announcement</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_220px]">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Title"
              required
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={form.audience}
              onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="cohort">Cohort</option>
              <option value="global">Everyone</option>
              <option value="staff">Staff only</option>
            </select>
            <select
              value={form.cohort_id}
              onChange={(event) => setForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
              disabled={form.audience !== 'cohort'}
              required={form.audience === 'cohort'}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
            >
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
              ))}
            </select>
          </div>
          <textarea
            value={form.body}
            onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
            placeholder="What should students know?"
            required
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Pin this
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.send_push}
                  onChange={(event) => setForm((prev) => ({ ...prev, send_push: event.target.checked }))}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Send push
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {saving ? 'Posting...' : 'Post announcement'}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No announcements yet.
            </div>
          ) : announcements.map((announcement) => (
            <article
              key={announcement.id}
              className={`rounded-lg border bg-white p-4 ${announcement.read_at ? 'border-slate-200' : 'border-primary-200'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{announcement.title}</h2>
                    {announcement.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                        <Pin className="h-3 w-3" />
                        Pinned
                      </span>
                    )}
                    {!announcement.read_at && (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Unread</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {announcement.cohort_name || (announcement.audience === 'staff' ? 'Staff' : 'Everyone')} · {formatDate(announcement.published_at)}
                  </p>
                </div>
                {announcement.status && announcement.status !== 'published' && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">{announcement.status}</span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{announcement.body}</p>
            </article>
          ))}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="font-semibold text-slate-900">{selected ? selected.title : 'Notification status'}</h2>
          <p className="mt-2 text-sm text-slate-600">
            {selected
              ? selected.body
              : unreadCount > 0
                ? `You have ${unreadCount} unread update${unreadCount === 1 ? '' : 's'}.`
                : 'You are caught up.'}
          </p>
        </aside>
      </div>
    </div>
  )
}
