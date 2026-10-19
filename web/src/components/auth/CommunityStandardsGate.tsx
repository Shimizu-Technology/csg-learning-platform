import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'

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
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-surface-page px-4 py-12">
      <section className="app-surface w-full max-w-xl overflow-hidden">
        <div className="surface-inverse bg-surface-inverse px-6 py-8 text-white sm:px-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
          <p className="mt-6 text-xs font-semibold text-slate-300">Before you participate</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Keep the CSG community safe</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Review the rules that apply when you send messages, upload work, ask for help, or share files.</p>
        </div>
        <div className="space-y-5 px-6 py-7 sm:px-8">
          <ul className="space-y-3 text-sm leading-6 text-ink-secondary">
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />Your learning records and content are handled as described in our Privacy Policy.</li>
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><Link className="app-link inline-flex min-h-11 items-center underline" to="/terms" target="_blank">Read Terms & Community Guidelines</Link><Link className="app-link inline-flex min-h-11 items-center underline" to="/privacy" target="_blank">Read Privacy Policy</Link></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-sunken p-4">
            <input className="mt-1 h-5 w-5 shrink-0 accent-slate-900" type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
            <span className="text-sm font-semibold leading-6 text-ink">I agree to the Terms and Community Guidelines and acknowledge the Privacy Policy.</span>
          </label>
          {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-semibold text-danger-700">{error}</p>}
          <Button size="lg" fullWidth disabled={!agree || saving} onClick={() => void accept()}>{saving ? 'Saving…' : 'Agree and enter CSG Connect'}</Button>
        </div>
      </section>
    </main>
  )
}
