import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, Circle } from 'lucide-react'
import { humanize } from '../../lib/glossary'
import { api } from '../../lib/api'
import type { CohortDetail, CurriculumSummary, UserListItem } from '../../types/api'
import { UnsavedChangesGuard } from '../shared/UnsavedChangesGuard'
import { Button } from '../ui/Button'

const steps = ['Curriculum', 'Support instructor', 'Pricing', 'Catalog page', 'Readiness', 'Publish']
const labels: Record<string, string> = { curriculum_assigned: 'Active curriculum assigned', price_set: 'Stripe price and display price set', support_instructor_set: 'Support instructor assigned', published_content: 'Curriculum has published content', cohort_active: 'Cohort is active', catalog_copy: 'Public title, description and image set', school_checkout_enabled: 'School checkout is on' }
export function SetupWizard({ cohort, onSaved }: { cohort: CohortDetail; onSaved: () => void }) {
  const [step, setStep] = useState(0)
  const [curricula, setCurricula] = useState<CurriculumSummary[]>([])
  const [staff, setStaff] = useState<UserListItem[]>([])
  const [draft, setDraft] = useState<{ curriculum_id: number; support_instructor_id: number | null | undefined; public_price_cents: number | null | undefined; stripe_price_id: string; public_title: string; public_description: string; public_image_url: string }>({ curriculum_id: cohort.curriculum_id, support_instructor_id: cohort.support_instructor_id, public_price_cents: cohort.public_price_cents, stripe_price_id: cohort.stripe_price_id || '', public_title: cohort.public_title || '', public_description: cohort.public_description || '', public_image_url: cohort.public_image_url || '' })
  const [saved, setSaved] = useState(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const [readiness, setReadiness] = useState<Record<string, boolean>>({})
  const [school, setSchool] = useState<{ enabled: boolean; stripe_configured: boolean; webhook_configured: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false)
  useEffect(() => {
    void api.getCurricula().then(r => { if (r.data) setCurricula(r.data.curricula) })
    void api.getUsers({ role: 'instructor' }).then(r => { if (r.data) setStaff(r.data.users.filter(u => !u.archived_at)) })
  }, [])
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void api.getSetupReadiness(cohort.id, draft).then(r => {
        if (!active) return
        if (!r.data || r.error || r.fromCache) { setError(r.error || 'Readiness unavailable. Try again.'); return }
        setError(r.data.errors.join(' ')); setSchool(r.data.school_checkout); setReadiness(r.data.readiness); setVerified(r.data.errors.length === 0)
      }).catch(() => { if (active) setError('Readiness unavailable. Try again.') })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [cohort.id, draft])
  function change(key: string, value: unknown) { setVerified(false); setDraft(d => ({ ...d, [key]: value })) }
  async function save(publish = false) {
    setBusy(true); setError(''); setVerified(false)
    try {
      if (step === 1 && draft.support_instructor_id) {
        const assigned = await api.getCohortInstructorAssignments(cohort.id)
        if (!assigned.data || assigned.error) throw new Error('Could not check teaching assignments.')
        if (!assigned.data.instructors.some(i => i.id === Number(draft.support_instructor_id))) {
          const result = await api.createCohortInstructorAssignment(cohort.id, Number(draft.support_instructor_id))
          if (result.error) throw new Error(result.error)
        }
      }
      // An instructor is saved only after its cohort assignment exists.
      const patch = step === 1 ? { support_instructor_id: draft.support_instructor_id } : step === 0 ? { curriculum_id: draft.curriculum_id } : step === 2 ? { public_price_cents: draft.public_price_cents, stripe_price_id: draft.stripe_price_id } : step === 3 ? { public_title: draft.public_title, public_description: draft.public_description, public_image_url: draft.public_image_url } : publish ? { public_checkout_enabled: true } : {}
      const result = await api.updateCohort(cohort.id, patch)
      if (!result.data || result.error) throw new Error(result.error || 'Could not save step.')
      const check = await api.getSetupReadiness(cohort.id)
      if (!check.data || check.error) throw new Error('Saved, but readiness could not refresh.')
      setSaved(s => ({ ...s, ...patch }));
      setError(check.data.errors.join(' ')); setSchool(check.data.school_checkout); setReadiness(check.data.readiness); setVerified(check.data.errors.length === 0)
      if (!publish) setStep(s => Math.min(5, s + 1))
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save step.') }
    finally { setBusy(false) }
  }
  const field = (key: keyof typeof draft) => String(draft[key] ?? '')
  const complete = [readiness.curriculum_assigned, readiness.support_instructor_set, readiness.price_set, readiness.catalog_copy, Object.values(readiness).length > 0 && Object.values(readiness).every(Boolean), cohort.public_checkout_enabled]
  return <section className="app-surface overflow-hidden" aria-labelledby="setup-title"><UnsavedChangesGuard dirty={dirty} pathnameOnly={false} /><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5"><h2 id="setup-title" className="text-lg font-bold">Get this course ready to sell</h2><span className="text-sm text-ink-muted">{complete.filter(Boolean).length} of 6 done</span></div><div className="grid md:grid-cols-[230px_1fr]"><nav aria-label="Setup steps" className="border-b border-line p-3 md:border-r md:border-b-0">{steps.map((label, i) => { const Icon = complete[i] ? CheckCircle : Circle; return <button key={label} type="button" disabled={busy} aria-pressed={step === i} onClick={() => setStep(i)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold ${step === i ? 'bg-primary-soft text-primary-ink' : 'text-ink-secondary'}`}><Icon className="h-5 w-5 shrink-0" />{label}</button> })}</nav><div className="space-y-4 p-5 sm:p-6">
    {step === 0 && <><label className="block text-sm font-semibold">Curriculum<select disabled={cohort.students.length > 0} className="app-control mt-2 w-full" value={field('curriculum_id')} onChange={e => change('curriculum_id', Number(e.target.value))}><option value="">Choose an active curriculum</option>{curricula.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p className="text-sm text-ink-secondary">{cohort.students.length > 0 && 'Curriculum is locked while students are enrolled. '}Type: {humanize(cohort.cohort_type)} · Delivery: Self-paced. Lessons appear in order without a weekly schedule.</p></>}
    {step === 1 && <><label className="block text-sm font-semibold">Support instructor<select className="app-control mt-2 w-full" value={field('support_instructor_id')} onChange={e => change('support_instructor_id', Number(e.target.value) || null)}><option value="">Choose an instructor</option>{staff.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}</select></label><p className="text-sm text-ink-secondary">Saving assigns this instructor to the cohort and makes them the support instructor.</p><Link className="app-link" to={`/admin/cohorts/${cohort.id}?tab=team`}>Teaching team</Link></>}
    {step === 2 && <><label className="block text-sm font-semibold">Display price (USD)<input className="app-control mt-2 w-full" type="number" min="0.01" step="0.01" value={draft.public_price_cents == null ? '' : Number(draft.public_price_cents) / 100} onChange={e => change('public_price_cents', e.target.value ? Math.round(Number(e.target.value) * 100) : null)} /></label><label className="block text-sm font-semibold">Stripe price ID<input className="app-control mt-2 w-full" value={field('stripe_price_id')} onChange={e => change('stripe_price_id', e.target.value.trim())} /></label><p className="text-sm text-ink-secondary">Use a Price ID starting with price_, such as price_example123. A Product ID (prod_) will not work.</p></>}
    {step === 3 && <><label className="block text-sm font-semibold">Public title<input className="app-control mt-2 w-full" value={field('public_title')} onChange={e => change('public_title', e.target.value)} /></label><label className="block text-sm font-semibold">Description<textarea className="app-control mt-2 w-full" value={field('public_description')} onChange={e => change('public_description', e.target.value)} /></label><label className="block text-sm font-semibold">Image URL (HTTPS)<input className="app-control mt-2 w-full" type="url" value={field('public_image_url')} onChange={e => change('public_image_url', e.target.value)} /></label><div className="rounded-xl border border-line p-4"><p className="text-xs text-ink-muted">Catalog preview</p><h3 className="mt-2 font-bold">{field('public_title') || 'Add a public title'}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{field('public_description') || 'Add a description'}</p></div><p className="text-sm text-ink-secondary">Learners see this copy. The internal cohort name stays private.</p></>}
    {step >= 4 && <>{school && <div className="rounded-xl border border-line p-3 text-sm"><h3 className="font-semibold">School checkout status</h3><p>Checkout available: {school.enabled ? 'Yes' : 'No'}</p><p>Stripe configured: {school.stripe_configured ? 'Yes' : 'No'}</p><p>Webhook configured: {school.webhook_configured ? 'Yes' : 'No'}</p><p className="mt-2 text-ink-secondary">If checkout is unavailable, ask the school administrator to check sales controls and payment configuration.</p></div>}<ul className="space-y-3">{Object.entries(readiness).map(([key, value]) => <li key={key} className="flex items-center gap-2 text-sm">{value ? <CheckCircle className="h-5 w-5 text-success-ink" /> : <Circle className="h-5 w-5 text-ink-muted" />}{value ? 'Ready: ' : 'Needed: '}{labels[key] || key}</li>)}</ul><p className="text-sm text-ink-secondary">Checked by the server when you open this card, edit a field or save a step. Cohorts become active on their start date in the school time zone.</p><Link className="app-link" to={`/admin/cohorts/${cohort.id}?tab=settings`}>Cohort settings</Link></>}
    {dirty && <p role="status" className="text-sm text-ink-secondary">Current values are unsaved. Readiness previews this draft; save each edited step before publishing.</p>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    <div className="flex flex-wrap gap-3">{step < 5 ? <Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save and continue'}</Button> : <Button disabled={busy || dirty || !verified || !Object.values(readiness).length || !Object.values(readiness).every(Boolean) || cohort.public_checkout_enabled} onClick={() => void save(true)}>{cohort.public_checkout_enabled ? 'Published' : 'Publish course'}</Button>}<Link className="app-link inline-flex min-h-11 items-center" to={`/courses?offering_id=${cohort.id}`}>View in catalog</Link></div>
  </div></div></section>
}
