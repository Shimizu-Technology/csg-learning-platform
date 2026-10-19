import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'
import { PRODUCT_NAME } from '../../lib/brand'

export function CommunityStandardsGate({ version, onAccepted }: { version: string; onAccepted: () => Promise<unknown> }) {
  const [agree, setAgree] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const accept = async () => {
    if (!agree || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api.acceptCommunityPolicy(version)
      if (!result.data) {
        setError(result.error || 'Could not save your acceptance. Try again.')
        return
      }
      await onAccepted()
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Could not save your acceptance. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-surface-page px-4 pb-28 pt-6 sm:py-12 lg:pb-12">
      <section aria-labelledby="community-gate-title" className="w-full max-w-xl overflow-hidden rounded-md border border-brand-line bg-surface-raised shadow-raised">
        <div className="border-b border-brand-line bg-brand-cream px-5 py-6 sm:px-8 sm:py-8">
          <span className="hidden h-11 w-11 items-center justify-center rounded-md border border-brand-line bg-surface-raised text-ruby-700 sm:flex"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <p className="brand-eyebrow sm:mt-5">Welcome to {PRODUCT_NAME}</p>
          <h1 id="community-gate-title" className="mt-3 font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink sm:text-4xl">Before class: our community guidelines</h1>
          <p className="mt-3 text-base leading-6 text-ink-secondary sm:leading-7">These apply when you send messages, upload work, ask for help, or share files. You only need to agree once.</p>
        </div>
        <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-7">
          <ul className="space-y-3 text-sm leading-6 text-ink-secondary">
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Your learning records and content are handled as described in our Privacy Policy.</li>
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><Link className="app-link inline-flex min-h-11 items-center underline" to="/terms" target="_blank">Read Terms & Community Guidelines</Link><Link className="app-link inline-flex min-h-11 items-center underline" to="/privacy" target="_blank">Read Privacy Policy</Link></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-brand-line bg-brand-cream p-4">
            <input className="mt-1 h-5 w-5 shrink-0 accent-ruby-700" type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
            <span className="text-sm font-semibold leading-6 text-ink">I agree to the Terms and Community Guidelines and acknowledge the Privacy Policy.</span>
          </label>
          {error && <p role="alert" className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-semibold text-danger-700">{error}</p>}
          <Button size="lg" shape="brand" fullWidth disabled={!agree || saving} onClick={() => void accept()}>{saving ? 'Saving…' : 'Agree and continue'}</Button>
        </div>
      </section>
    </main>
  )
}
