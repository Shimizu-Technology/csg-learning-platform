import { CheckCircle2, Clock3, Mail, MailWarning, MailX } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { InvitePresentation } from '../../lib/inviteStatus'

const ICONS = {
  accepted: CheckCircle2,
  sent: Mail,
  queued: Clock3,
  failed: MailX,
  expired: MailWarning,
  not_sent: Mail,
} as const

/** Sent / Accepted / Failed / Expired (and Sending / Not sent) as one Badge. */
export function InviteStatusBadge({ presentation }: { presentation: InvitePresentation }) {
  const Icon = ICONS[presentation.state]
  return (
    <Badge tone={presentation.tone} icon={<Icon className="h-3 w-3" aria-hidden="true" />}>
      {presentation.label}
    </Badge>
  )
}
