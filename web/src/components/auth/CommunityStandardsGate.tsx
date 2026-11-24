import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { PublicHeader } from '../brand/PublicChrome'
import { Button } from '../ui/Button'
import { brand, PRODUCT_NAME } from '../../lib/brand'

interface CommunityStandardsGateProps {
  version: string
  onAccepted: () => Promise<unknown>
  accountEmail?: string | null
  onSignOut?: () => Promise<unknown> | void
}

export function CommunityStandardsGate({ version, onAccepted, accountEmail, onSignOut }: CommunityStandardsGateProps) {
  const [agree, setAgree] = useState(false)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')

  const accept = async () => {
    if (!agree || saving || signingOut) return
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

  const handleSignOut = async () => {
    if (!onSignOut || saving || signingOut) return
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      <PublicHeader />
      <main className="safe-px flex flex-1 items-center justify-center py-8 sm:py-12">
        <div className="w-full max-w-xl">
          <section aria-labelledby="community-gate-title" className="w-full overflow-hidden rounded-2xl border border-brand-line bg-surface-raised shadow-raised">
            <div className="border-b border-brand-line bg-brand-cream px-5 py-6 sm:px-8 sm:py-8">
              <span className="hidden h-11 w-11 items-center justify-center rounded-md border border-brand-line bg-surface-raised text-primary-ink sm:flex"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
              <p className="brand-eyebrow sm:mt-5">Welcome to {PRODUCT_NAME}</p>
              <h1 id="community-gate-title" className="mt-3 font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink sm:text-4xl">Before class: our community guidelines</h1>
              <p className="mt-3 text-base leading-6 text-ink-secondary sm:leading-7">These apply when you send messages, upload work, ask for help, or share files. You only need to agree once.</p>
            </div>
            <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-7">
              {accountEmail && (
                <div className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
                  <p className="text-xs font-semibold text-ink-secondary">Signed in as</p>
                  <p className="mt-0.5 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{accountEmail}</p>
                </div>
              )}
              <ul className="space-y-3 text-sm leading-6 text-ink-secondary">
                <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</li>
                <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</li>
                <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />Your learning records and content are handled as described in our privacy policy.</li>
              </ul>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><Link className="app-link inline-flex min-h-11 items-center underline" to="/terms" target="_blank">Read the terms and community guidelines</Link><Link className="app-link inline-flex min-h-11 items-center underline" to="/privacy" target="_blank">Read the privacy policy</Link></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-line bg-brand-cream p-4">
                <input className="mt-1 h-5 w-5 shrink-0 accent-action-primary" type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
                <span className="text-sm font-semibold leading-6 text-ink">I agree to the terms and community guidelines and acknowledge the privacy policy.</span>
              </label>
              {error && <p role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-ink">{error}</p>}
              <Button size="lg" shape="brand" fullWidth disabled={!agree || saving || signingOut} onClick={() => void accept()}>{saving ? 'Saving…' : 'Agree and continue'}</Button>
              {onSignOut && (
                <Button size="lg" shape="brand" variant="secondary" fullWidth disabled={saving || signingOut} onClick={() => void handleSignOut()}>
                  {signingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                  {signingOut ? 'Signing out…' : 'Use a different account'}
                </Button>
              )}
            </div>
          </section>
          <p className="mt-5 text-center text-sm leading-6 text-ink-secondary">
            Need help? Email{' '}
            <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
          </p>
        </div>
      </main>
    </div>
  )
}
