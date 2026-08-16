import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'

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
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f7f4ef] px-4 py-12">
      <section className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.1)]">
        <div className="bg-[#17191f] px-6 py-8 text-white sm:px-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600"><ShieldCheck className="h-6 w-6" /></span>
          <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.18em] text-primary-300">Before you participate</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Keep the CSG community safe</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Review the rules that apply when you send messages, upload work, ask for help, or share files.</p>
        </div>
        <div className="space-y-5 px-6 py-7 sm:px-8">
          <ul className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-green-600" />Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-green-600" />Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</li>
            <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-green-600" />Your learning records and content are handled as described in our Privacy Policy.</li>
          </ul>
          <div className="flex flex-wrap gap-4 text-sm font-bold"><Link className="text-primary-700 underline underline-offset-4" to="/terms" target="_blank">Read Terms & Community Guidelines</Link><Link className="text-primary-700 underline underline-offset-4" to="/privacy" target="_blank">Read Privacy Policy</Link></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input className="mt-1 h-5 w-5 accent-red-700" type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
            <span className="text-sm font-bold leading-6 text-slate-800">I agree to the Terms and Community Guidelines and acknowledge the Privacy Policy.</span>
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
          <button type="button" disabled={!agree || saving} onClick={() => void accept()} className="min-h-12 w-full rounded-xl bg-primary-700 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-45">{saving ? 'Saving…' : 'Agree and enter CSG Connect'}</button>
        </div>
      </section>
    </main>
  )
}
