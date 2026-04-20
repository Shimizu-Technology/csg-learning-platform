import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, BellOff, Hash, Lock, Plus, RefreshCw, Send } from 'lucide-react'
import { api } from '../../lib/api'
import { disablePushNotifications, enablePushNotifications, pushSupported } from '../../lib/pushNotifications'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { ChannelMessage, ChannelSummary, CohortSummary } from '../../types/api'

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function preview(text: string) {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

export function Messages() {
  const { channelId } = useParams()
  const { user } = useAuthContext()
  const isStaff = Boolean(user?.is_staff)
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(channelId ? Number(channelId) : null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [channelError, setChannelError] = useState('')
  const [channelForm, setChannelForm] = useState({
    cohort_id: '',
    name: '',
    description: '',
    visibility: 'cohort',
  })
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(
    () => channels.find((channel) => channel.id === selectedId) || null,
    [channels, selectedId],
  )

  const loadChannels = async () => {
    const res = await api.getChannels()
    if (res.data) {
      setChannels(res.data.channels)
      setSelectedId((current) => current || res.data!.channels[0]?.id || null)
    }
    setLoading(false)
  }

  const loadChannel = async (id: number, markRead = false) => {
    const res = await api.getChannel(id)
    if (res.data) {
      setMessages(res.data.messages || [])
      setChannels((prev) => prev.map((channel) => channel.id === id ? res.data!.channel : channel))
      if (markRead) {
        await api.markChannelRead(id)
        setChannels((prev) => prev.map((channel) => channel.id === id ? { ...channel, unread_count: 0, last_read_at: new Date().toISOString() } : channel))
      }
    }
  }

  useEffect(() => {
    loadChannels()
    if (isStaff) {
      api.getCohorts().then((res) => {
        if (res.data) {
          setCohorts(res.data.cohorts)
          setChannelForm((prev) => ({ ...prev, cohort_id: String(res.data!.cohorts[0]?.id || '') }))
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
    if (channelId) setSelectedId(Number(channelId))
  }, [channelId])

  useEffect(() => {
    if (!selectedId) return

    loadChannel(selectedId, true)
    const interval = window.setInterval(() => loadChannel(selectedId, true), 15000)
    const onFocus = () => loadChannel(selectedId, true)
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [selectedId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, selectedId])

  const selectChannel = (id: number) => {
    window.history.replaceState(null, '', `/messages/${id}`)
    setSelectedId(id)
  }

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedId || !body.trim()) return

    setSending(true)
    setError('')
    const res = await api.createMessage(selectedId, { body: body.trim(), send_push: true })
    if (res.error) {
      setError(res.error)
    } else {
      setBody('')
      await loadChannel(selectedId, true)
      await loadChannels()
    }
    setSending(false)
  }

  const handleCreateChannel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!channelForm.cohort_id || !channelForm.name.trim()) return

    setCreatingChannel(true)
    setChannelError('')
    const res = await api.createChannel({
      cohort_id: Number(channelForm.cohort_id),
      name: channelForm.name.trim(),
      description: channelForm.description.trim() || undefined,
      visibility: channelForm.visibility,
    })

    if (res.error) {
      setChannelError(res.error)
    } else if (res.data) {
      setChannelForm((prev) => ({ ...prev, name: '', description: '' }))
      setShowChannelForm(false)
      await loadChannels()
      selectChannel(res.data.channel.id)
    }
    setCreatingChannel(false)
  }

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Message notifications are off for this device.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
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
      setPushMessage('Message notifications are on for this device.')
    } catch (toggleError) {
      setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not enable notifications.')
    }
  }

  if (loading) return <LoadingSpinner message="Loading messages..." />

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:h-[calc(100vh-4rem)]">
      <div>
        <p className="text-sm font-medium text-primary-600">Communication</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
            <p className="mt-1 text-sm text-slate-500">Class channels for quick questions, links, and day-to-day updates.</p>
          </div>
          {pushSupported() && (
            <button
              onClick={handleTogglePush}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              {pushEnabled ? 'Turn off push' : 'Turn on push'}
            </button>
          )}
        </div>
        {pushMessage && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {pushMessage}
          </div>
        )}
      </div>

      <div className="grid min-h-[640px] overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
            <div className="flex items-center gap-1">
              {isStaff && (
                <button
                  onClick={() => setShowChannelForm((current) => !current)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Create channel"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={loadChannels}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Refresh channels"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isStaff && showChannelForm && (
            <form onSubmit={handleCreateChannel} className="border-b border-slate-200 p-3">
              {channelError && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {channelError}
                </div>
              )}
              <div className="space-y-2">
                <select
                  value={channelForm.cohort_id}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                  ))}
                </select>
                <input
                  value={channelForm.name}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Channel name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <textarea
                  value={channelForm.description}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="What is this channel for?"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <select
                  value={channelForm.visibility}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="cohort">Students and staff</option>
                  <option value="staff_only">Staff only</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingChannel || !channelForm.cohort_id || !channelForm.name.trim()}
                  className="w-full rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  {creatingChannel ? 'Creating...' : 'Create channel'}
                </button>
              </div>
            </form>
          )}

          <div className="max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100vh-11rem)]">
            {channels.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-500">No channels yet.</div>
            ) : channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => selectChannel(channel.id)}
                className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                  channel.id === selectedId ? 'bg-primary-50 text-primary-800' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {channel.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />}
                    <span className="truncate text-sm font-semibold">{channel.name}</span>
                  </span>
                  {channel.unread_count > 0 && (
                    <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white">
                      {channel.unread_count}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{channel.cohort_name}</p>
                {channel.latest_message && (
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {channel.latest_message.author_name}: {preview(channel.latest_message.body)}
                  </p>
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-[520px] flex-col">
          {selected ? (
            <>
              <header className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  {selected.visibility === 'staff_only' ? <Lock className="h-5 w-5 text-slate-500" /> : <Hash className="h-5 w-5 text-slate-500" />}
                  <div>
                    <h2 className="font-semibold text-slate-900">{selected.name}</h2>
                    <p className="text-xs text-slate-500">{selected.cohort_name}</p>
                  </div>
                </div>
                {selected.description && <p className="mt-2 text-sm text-slate-500">{selected.description}</p>}
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4">
                {messages.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">No messages yet. Start the conversation.</div>
                ) : messages.map((message) => (
                  <div key={message.id} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-lg px-4 py-3 shadow-sm ${message.mine ? 'bg-primary-500 text-white' : 'bg-white text-slate-800'}`}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs opacity-80">
                        <span className="font-semibold">{message.author.full_name}</span>
                        <span>{formatTime(message.created_at)}</span>
                        {message.edited_at && <span>Edited</span>}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={handleSend} className="border-t border-slate-200 p-3">
                {error && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={`Message ${selected.name}`}
                    rows={2}
                    className="min-h-12 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={sending || !body.trim()}
                    className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {sending ? 'Sending' : 'Send'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">Press Cmd+Enter or Ctrl+Enter to send.</p>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Select a channel to start messaging.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
