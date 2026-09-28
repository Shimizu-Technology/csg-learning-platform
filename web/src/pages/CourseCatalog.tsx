import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpenText, Clock3, GraduationCap, MessageCircle } from 'lucide-react'
import { api } from '../lib/api'
import { useAuthContext } from '../contexts/AuthContext'
import { hasCourseAccess } from '../lib/courseAccess'

type Offering = NonNullable<Awaited<ReturnType<typeof api.getCourseOfferings>>['data']>['offerings'][number]

export function CourseCatalog() {
  const { isSignedIn, user, enrollments, syncSession } = useAuthContext()
  const [searchParams] = useSearchParams()
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    api.getCourseOfferings().then((result) => {
      if (!active) return
      setOfferings(result.data?.offerings || [])
      setError(result.error ? 'Course listings could not load right now.' : null)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reloadKey])

  useEffect(() => {
    if (searchParams.get('checkout') === 'return' && isSignedIn) void syncSession()
  }, [isSignedIn, searchParams, syncSession])

  const startCheckout = async (cohortId: number) => {
    setCheckingOut(cohortId)
    setError(null)
    try {
      const result = await api.startCourseCheckout(cohortId)
      if (result.data?.url) {
        window.location.assign(result.data.url)
        return
      }
      setError(result.error || 'Checkout could not start. Please try again.')
    } finally {
      setCheckingOut(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f4ef] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-5">
          <Link to="/" className="inline-flex min-h-11 items-center gap-3 font-extrabold"><GraduationCap className="h-6 w-6 text-primary-600" />CSG Learning</Link>
          <Link to={isSignedIn ? '/dashboard' : '/sign-in'} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-primary-700 hover:bg-primary-50">{isSignedIn ? 'My learning' : 'Sign in'}</Link>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <p className="app-eyebrow">Focused courses</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Learn one useful skill at a time.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Study on your schedule, build a small project yourself, and ask a real instructor course questions. Optional lessons show how to extend and verify the work with AI. Built in Guam for learners wherever they are.</p>
        {searchParams.get('checkout') === 'return' && <p role="status" className="mt-8 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">Thanks for checking out. Payment confirmation may take a moment; your course will appear in My learning after it is confirmed.</p>}
        {searchParams.get('checkout') === 'canceled' && <p role="status" className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Checkout was canceled. You have not been enrolled.</p>}
        {error && offerings.length > 0 && <p role="alert" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {offerings.map((offering) => {
            const enrolled = enrollments.some((entry) => entry.cohort.id === offering.id && hasCourseAccess(entry))
            return <article key={offering.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700"><BookOpenText className="h-6 w-6" /></span>
              <p className="mt-6 text-xs font-extrabold uppercase tracking-widest text-primary-700">Self-paced course</p>
              <h2 className="mt-2 text-2xl font-extrabold">{offering.name}</h2>
              <p className="mt-2 text-sm text-slate-600">{offering.curriculum_name}</p>
              {offering.checkout_available && offering.price_cents && <p className="mt-3 text-2xl font-extrabold">${(offering.price_cents / 100).toFixed(2)} <span className="text-sm font-semibold text-slate-500">USD one-time</span></p>}
              <div className="mt-7 space-y-3 text-sm text-slate-700">
                <p className="flex items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />{offering.access_months} months of lesson access from confirmed payment</p>
                <p className="flex items-start gap-3"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />Course questions to an instructor for {offering.instructor_message_weeks} weeks from your first course open. Response target: {offering.instructor_response_target}.</p>
              </div>
              <p className="mt-6 text-xs leading-5 text-slate-500">Private meetings and individual project review are offered through guided courses.</p>
              <div className="mt-auto pt-7">
                {enrolled ? <Link to={`/materials?cohort_id=${offering.id}`} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white">Open course <ArrowRight className="h-4 w-4" /></Link>
                  : !offering.checkout_available ? <span className="inline-flex min-h-12 items-center text-sm font-bold text-slate-500">Enrollment is not open yet</span>
                  : !isSignedIn || !user ? <Link to="/sign-up" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white">Create an account to enroll <ArrowRight className="h-4 w-4" /></Link>
                  : <button type="button" disabled={checkingOut !== null} onClick={() => void startCheckout(offering.id)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white disabled:opacity-50">{checkingOut === offering.id ? 'Opening checkout…' : 'Continue to secure checkout'} <ArrowRight className="h-4 w-4" /></button>}
              </div>
            </article>
          })}
          {!loading && offerings.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 md:col-span-2">
            <h2 className="text-xl font-extrabold">{error ? 'Course listings are unavailable' : 'Courses are being prepared'}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{error || 'We are recording and testing the first focused course. Enrollment will appear here when it opens.'}</p>
            {error && <button type="button" onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }} className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-900 hover:bg-slate-50">Try again</button>}
          </div>}
        </div>
      </div>
    </main>
  )
}
