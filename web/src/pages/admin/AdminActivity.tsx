import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { StaffActivityFeed } from '../../components/admin/StaffActivityFeed'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'

export function AdminActivity() {
  const [choices, setChoices] = useState<{ cohorts: { id: number; name: string }[]; learners: { id: number; name: string }[]; actors: { id: number; name: string }[] }>({ cohorts: [], learners: [], actors: [] })
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void Promise.all([api.getCohorts(), api.getUsers({ include_archived: 'true' })]).then(([cohorts, users]) => {
      if (!active) return
      if (!cohorts.data || !users.data || cohorts.error || users.error) { setError('Activity filter choices are unavailable.'); return }
      const actors = users.data.users.map((user) => ({ id: user.id, name: user.full_name || user.email }))
      setChoices({ cohorts: cohorts.data.cohorts.map(({ id, name }) => ({ id, name })), actors, learners: actors.filter((person) => users.data!.users.some((user) => user.id === person.id && user.role === 'student')) })
      setError(null)
    })
    return () => { active = false }
  }, [retry])
  return <div className="app-page-wide space-y-5"><PageHeader title="School activity" description="Recorded learning and work across cohorts. Staff actions identify who acted for the learner." />{error && <div role="alert" className="app-surface p-4">{error}<Button variant="quiet" onClick={() => setRetry((value) => value + 1)}>Retry filters</Button></div>}<StaffActivityFeed {...choices} /></div>
}
