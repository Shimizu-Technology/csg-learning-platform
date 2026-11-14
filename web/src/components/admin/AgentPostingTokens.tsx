import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bot, Check, Copy, KeyRound, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { formatShortDate } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import type { AgentPostingToken } from '../../types/api'

const STATUS_TONES: Record<AgentPostingToken['status'], BadgeTone> = { active: 'success', expired: 'warning', revoked: 'neutral' }
const STATUS_LABELS: Record<AgentPostingToken['status'], string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }
const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '', label: 'No expiry' },
]

/** Admin-only: tokens that let the admin's own assistant post messages as them. */
export function AgentPostingTokens() {
  const toast = useToast()
  const confirmAction = useConfirm()
  const nameId = useId()
  const expiryId = useId()
  const [tokens, setTokens] = useState<AgentPostingToken[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  /** Bumped by every load, create and revoke: a list response older than the latest change is ignored. */
  const listVersionRef = useRef(0)

  const load = useCallback(async () => {
    const version = ++listVersionRef.current
    setLoadError(null)
    const result = await api.getAgentPostingTokens()
    if (version !== listVersionRef.current) return
    if (!result.data) {
      setLoadError(result.error || 'Could not load assistant tokens.')
      return
    }
    setTokens(result.data.agent_posting_tokens)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const label = name.trim()
    if (!label) {
      setFormError('Give the token a name so you can recognize it later.')
      return
    }
    setCreating(true)
    setFormError(null)
    const result = await api.createAgentPostingToken({ name: label, expires_in_days: expiry ? Number(expiry) : null })
    setCreating(false)
    if (!result.data) {
      setFormError(result.error || 'Could not create the token.')
      return
    }
    const created = result.data
    listVersionRef.current += 1
    setTokens((current) => [created.agent_posting_token, ...(current ?? [])])
    setRevealed({ name: created.agent_posting_token.name, token: created.token })
    setCopied(false)
    setName('')
  }

  const copy = async () => {
    if (!revealed) return
    if (await copyText(revealed.token)) {
      setCopied(true)
      toast.success('Token copied.')
    } else {
      toast.error('Copy failed. Select the token and copy it manually.')
    }
  }

  const revoke = async (token: AgentPostingToken) => {
    const confirmed = await confirmAction({
      title: `Revoke "${token.name}"?`,
      description: 'Any assistant using this token will immediately lose the ability to post as you. Messages it already sent stay in place.',
      confirmLabel: 'Revoke token',
      tone: 'danger',
    })
    if (!confirmed) return
    setRevokingId(token.id)
    const result = await api.revokeAgentPostingToken(token.id)
    setRevokingId(null)
    if (!result.data) return toast.error(result.error || 'Could not revoke the token.')
    const updated = result.data.agent_posting_token
    listVersionRef.current += 1
    setTokens((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)))
    toast.success(`"${updated.name}" was revoked.`)
  }

  return (
    <section className="app-surface overflow-hidden" aria-labelledby={`${nameId}-heading`}>
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <h2 id={`${nameId}-heading`} className="text-lg font-bold tracking-tight text-ink">Assistant posting tokens</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          Let your own assistant post Markdown messages as you, wherever you can post. A token can only send messages; it cannot read conversations or change anything else. Messages it sends show a small &ldquo;Sent via&rdquo; label.
        </p>
      </div>

      {revealed && (
        <div role="status" className="border-b border-line bg-success-50 px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-ink">Copy the token for &ldquo;{revealed.name}&rdquo; now</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">This is the only time it will be shown. Store it in your assistant&rsquo;s secret settings, not in chat or code.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label="New token"
              value={revealed.token}
              onFocus={(event) => event.currentTarget.select()}
              className="app-control min-w-0 flex-1 font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="quiet" onClick={() => setRevealed(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={(event) => void create(event)} className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end sm:px-6" noValidate>
        <div className="min-w-0">
          <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-ink-secondary">Token name</label>
          <input
            id={nameId}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="Home base assistant"
            className="app-control w-full"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? `${nameId}-error` : undefined}
          />
        </div>
        <div>
          <label htmlFor={expiryId} className="mb-1 block text-sm font-medium text-ink-secondary">Expires after</label>
          <select id={expiryId} value={expiry} onChange={(event) => setExpiry(event.target.value)} className="app-control w-full">
            {EXPIRY_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <Button type="submit" disabled={creating || tokens === null}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {creating ? 'Creating…' : 'Create token'}
        </Button>
        {formError && <p id={`${nameId}-error`} role="alert" className="text-sm text-danger-700 sm:col-span-3">{formError}</p>}
      </form>

      <div className="px-5 py-4 sm:px-6">
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-800">
            <span>{loadError}</span>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Try again</Button>
          </div>
        ) : tokens === null ? (
          <p role="status" className="text-sm text-ink-muted">Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-ink-secondary">No assistant tokens yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Assistant tokens">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-col gap-3 rounded-xl bg-surface-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-ink-secondary"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{token.name}</p>
                      <Badge tone={STATUS_TONES[token.status]}>{STATUS_LABELS[token.status]}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-ink-secondary">
                      Created {formatShortDate(token.created_at)}
                      {' · '}Last used {token.last_used_at ? formatShortDate(token.last_used_at) : 'never'}
                      {' · '}{token.revoked_at ? `Revoked ${formatShortDate(token.revoked_at)}` : token.expires_at ? `${token.status === 'expired' ? 'Expired' : 'Expires'} ${formatShortDate(token.expires_at)}` : 'No expiry'}
                    </p>
                  </div>
                </div>
                {token.status === 'active' && (
                  <Button variant="danger" size="sm" className="shrink-0 self-start sm:self-center" disabled={revokingId === token.id} onClick={() => void revoke(token)}>
                    {revokingId === token.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
