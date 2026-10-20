import type { BadgeTone } from '../components/ui/Badge'
import type { InviteState } from '../types/api'
import { formatShortDate } from './format'

/** Mirrors User::INVITE_LINK_LIFETIME in the API (Clerk invitation `expires_in_days`). */
export const INVITE_LINK_LIFETIME_DAYS = 30

export interface InviteFields {
  invite_pending?: boolean
  invite_delivery_status?: 'not_sent' | 'queued' | 'sent' | 'failed' | 'accepted' | null
  invite_state?: InviteState | null
  invite_sent_at?: string | null
  invite_expires_at?: string | null
  invite_last_error?: string | null
}

/** The API's derived state, or the same derivation for API builds that do not send it yet. */
export function resolveInviteState(member: InviteFields, now: Date = new Date()): InviteState {
  if (member.invite_state) return member.invite_state
  if (!member.invite_pending) return 'accepted'
  const status = member.invite_delivery_status || 'not_sent'
  if (status === 'sent' && member.invite_sent_at) {
    const expires = new Date(member.invite_sent_at).getTime() + INVITE_LINK_LIFETIME_DAYS * 86_400_000
    if (expires <= now.getTime()) return 'expired'
  }
  return status === 'accepted' ? 'not_sent' : status
}

export interface InvitePresentation {
  state: InviteState
  tone: BadgeTone
  label: string
  /** One line of supporting detail for staff (dates, failure reason), or null. */
  detail: string | null
  /** Label for the resend action, or null when no invite should be sent. */
  actionLabel: string | null
}

export function inviteStatusPresentation(member: InviteFields, now: Date = new Date()): InvitePresentation {
  const state = resolveInviteState(member, now)
  const sent = member.invite_sent_at ? formatShortDate(member.invite_sent_at) : null
  const expires = member.invite_expires_at
    ? formatShortDate(member.invite_expires_at)
    : member.invite_sent_at
      ? formatShortDate(new Date(new Date(member.invite_sent_at).getTime() + INVITE_LINK_LIFETIME_DAYS * 86_400_000))
      : null
  switch (state) {
    case 'accepted':
      return { state, tone: 'success', label: 'Accepted', detail: null, actionLabel: null }
    case 'sent':
      return { state, tone: 'pending', label: 'Invite sent', detail: sent ? `Sent ${sent}${expires ? ` · link works until ${expires}` : ''}` : null, actionLabel: 'Resend' }
    case 'queued':
      return { state, tone: 'pending', label: 'Sending invite', detail: 'Queued for delivery. Refresh in a minute to confirm it was sent.', actionLabel: 'Resend' }
    case 'failed':
      return { state, tone: 'danger', label: 'Invite failed', detail: member.invite_last_error ? `Not delivered: ${member.invite_last_error}` : 'The invite email was not delivered.', actionLabel: 'Retry invite' }
    case 'expired':
      return { state, tone: 'warning', label: 'Invite expired', detail: expires ? `The link expired ${expires}. Send a new one.` : 'The link has expired. Send a new one.', actionLabel: 'Send new invite' }
    default:
      return { state: 'not_sent', tone: 'neutral', label: 'Invite not sent', detail: 'No invite email has been sent yet.', actionLabel: 'Send invite' }
  }
}
