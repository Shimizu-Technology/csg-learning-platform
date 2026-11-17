import { useEffect, useState } from 'react'
import { Hash, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { RecordLink } from '../shared/RecordLink'
import { Badge } from '../ui/Badge'
import type { ChannelSummary } from '../../types/api'

/** A cohort's group conversations (channels), each linking to its page (L-5.2), on the cohort's Communication tab. */
export function CohortChannels({ cohortId, cohortName }: { cohortId: number; cohortName: string }) {
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void api.getChannels().then((result) => {
      if (!active) return
      if (result.data) setChannels(result.data.channels.filter((channel) => channel.cohort_id === cohortId))
      else setFailed(true)
    })
    return () => { active = false }
  }, [cohortId])

  if (failed) return <p className="mt-4 text-sm text-ink-muted">Group conversations couldn't load.</p>
  if (!channels) return <p className="mt-4 text-sm text-ink-muted">Loading group conversations…</p>
  if (!channels.length) return <p className="mt-4 text-sm text-ink-muted">No group conversations in {cohortName} yet.</p>
  return <ul className="mt-4 space-y-2" aria-label={`Group conversations in ${cohortName}`}>
    {channels.map((channel) => (
      <li key={channel.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">
        <Hash className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <RecordLink record={{ type: 'channel', id: channel.id, view: 'record' }} returnLabel={`${cohortName} · Communication`} variant="plain" touchTarget truncate className="min-w-0 flex-1 text-sm font-semibold" title={channel.name}>{channel.name}</RecordLink>
        {channel.visibility === 'staff_only' && <Badge icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />}>Staff only</Badge>}
      </li>
    ))}
  </ul>
}
