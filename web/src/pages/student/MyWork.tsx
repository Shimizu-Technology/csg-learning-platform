import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ClipboardCheck, Clock, MessageCircle, RefreshCw, RotateCcw, WifiOff } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { api } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { shortAgo } from '../../lib/recordRelated'
import { reviewTiming } from '../../lib/reviewCopy'
import { urlParsers, useUrlState } from '../../lib/useUrlState'
import { useLearnerPaths } from '../../lib/useRecordPath'
import { useMessageInstructor } from '../../lib/useMessageInstructor'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { MarkdownText } from '../../components/shared/MarkdownRenderer'
import { RecordLink } from '../../components/shared/RecordLink'
import { GradeChip } from '../../components/student/GradeChip'
import { TabButton } from '../../components/ui/Choice'
import { Button, LinkButton, buttonClasses } from '../../components/ui/Button'
import { TabList, TabPanel } from '../../components/ui/Motion'
import type { MyWork, MyWorkItem } from '../../types/api'

/*
 * My work (L-1.2, U-5.2; mockup 11-my-work.html): what needs the learner, what
 * waits for review, and what is graded, from GET /api/v1/my_work (MyWork,
 * LearnerProgress's latest attempts). Each tab's count is its list's length.
 * Rows name the reviewer, link to the exact block, quote the feedback in full
 * and offer "Ask about this feedback", which opens the instructor conversation
 * with the lesson linked. The tab lives in the URL (L-0.6).
 */

const TABS = ['needs_you', 'waiting', 'graded'] as const
type Tab = typeof TABS[number]
const TAB_LABELS: Record<Tab, string> = { needs_you: 'Needs you', waiting: 'Waiting for review', graded: 'Graded' }
const URL_STATE = { tab: urlParsers.oneOf(['auto', ...TABS] as const, 'auto') }
const GRADED_PAGE = 10

export function MyWorkPage() {
  const { selectedCohortId } = useCohortContext()
  const [work, setWork] = useState<MyWork | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notEnrolled, setNotEnrolled] = useState(false)
  const [{ tab: requested }, setUrlState] = useUrlState(URL_STATE)
  const request = useRef(0)

  const load = useCallback(() => {
    const current = ++request.current
    setLoading(true)
    setError(null)
    setNotEnrolled(false)
    api.getMyWork(selectedCohortId).then((result) => {
      if (current !== request.current) return
      if (result.data?.my_work) setWork(result.data.my_work)
      else if (result.errorKind === 'not_found') setNotEnrolled(true)
      else setError(result.error || 'Unable to load My work right now.')
    }).catch((reason: unknown) => {
      if (current === request.current) setError(reason instanceof Error ? reason.message : 'Unable to load My work right now.')
    }).finally(() => { if (current === request.current) setLoading(false) })
  }, [selectedCohortId])

  useEffect(() => { load() }, [load])

  if (loading && !work) return <LoadingSpinner message="Loading My work…" />
  if (notEnrolled) return <EmptyState icon={ClipboardCheck} title="No course yet" description="Work you hand in will appear here once you’re enrolled in a course." />
  if (error || !work) {
    return <EmptyState icon={WifiOff} title="Could not load My work" description={error || 'Unable to load My work right now.'}
      action={<Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
  }

  // With no tab chosen, open the first list that has something in it.
  const tab: Tab = requested !== 'auto' ? requested : work.counts.needs_you > 0 ? 'needs_you' : work.counts.waiting > 0 ? 'waiting' : 'graded'
  return (
    <div className="app-page max-w-4xl" data-page="my-work">
      <header data-page-header="">
        <h1 className="app-title">My work</h1>
        <p className="app-description mt-1" data-page-context="">Everything you’ve submitted in <RecordLink record={{ type: 'cohort', id: work.cohort.id }} variant="plain" returnLabel="My work" className="font-semibold text-ink-secondary">{work.cohort.name}</RecordLink></p>
      </header>
      <TabList label="My work" className="flex max-w-full overflow-x-auto border-b border-line">
        {TABS.map((key) => (
          <TabButton key={key} asTab selected={tab === key} count={work.counts[key]} id={`my-work-tab-${key}`} aria-controls={`my-work-panel-${key}`} onClick={() => setUrlState({ tab: key })} className="max-sm:flex-1 max-sm:px-2">
            {key === 'waiting' ? <>Waiting<span className="max-sm:sr-only"> for review</span></> : TAB_LABELS[key]}
          </TabButton>
        ))}
      </TabList>
      <TabPanel key={tab} id={`my-work-panel-${tab}`} aria-labelledby={`my-work-tab-${tab}`}>
        <WorkList work={work} tab={tab} />
      </TabPanel>
    </div>
  )
}

function WorkList({ work, tab }: { work: MyWork; tab: Tab }) {
  const [shown, setShown] = useState(GRADED_PAGE)
  const items = work[tab]
  if (items.length === 0) {
    const empty = {
      needs_you: { icon: RotateCcw, title: 'Nothing needs you right now', description: 'When your instructor asks for a redo, it appears here with their feedback.' },
      waiting: { icon: Clock, title: 'Nothing is waiting for review', description: 'Exercises and projects you hand in wait here until your instructor reviews them.' },
      graded: { icon: ClipboardCheck, title: 'No graded work yet', description: 'Your graded exercises and projects appear here with your instructor’s feedback.' },
    }[tab]
    return <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
  }
  const visible = tab === 'graded' ? items.slice(0, shown) : items
  return (
    <div className="space-y-3">
      <ul className="app-surface divide-y divide-line overflow-hidden">
        {visible.map((item) => <li key={item.submission_id}><WorkRow item={item} work={work} /></li>)}
      </ul>
      {visible.length < items.length && (
        <button type="button" onClick={() => setShown((value) => value + GRADED_PAGE * 3)} className={buttonClasses({ variant: 'secondary' })}>
          Show <span className="tabular-nums">{Math.min(items.length - visible.length, GRADED_PAGE * 3)}</span> more
        </button>
      )}
    </div>
  )
}

function WorkRow({ item, work }: { item: MyWorkItem; work: MyWork }) {
  const paths = useLearnerPaths(item.cohort_id)
  const messenger = useMessageInstructor(item.cohort_id)
  const asked = item.grader ?? work.reviewer
  const blockPath = paths.redo(item.lesson_id, item.content_block_id)
  const where = [item.module_name, item.week ? `Week ${item.week}` : null].filter(Boolean).join(' · ')
  const submitted = `submitted ${formatShortDate(item.submitted_at, '', { withYear: false })}`
  const reviewed = item.grader ? `reviewed by ${item.grader.full_name}${item.graded_at ? `, ${formatShortDate(item.graded_at, '', { withYear: false, weekday: true })}` : ''}` : 'reviewed'
  const waitingLine = work.reviewer
    ? `${work.reviewer.full_name.split(' ')[0]} ${reviewTiming(work.review_response_time).replace(/^usually\s+/i, 'usually reviews ')}`
    : `Your instructor will review it, ${reviewTiming(work.review_response_time)}`
  const meta = item.status === 'waiting'
    ? [where, `submitted ${shortAgo(item.submitted_at) === 'now' ? 'just now' : `${shortAgo(item.submitted_at)} ago`}`, waitingLine]
    : [where, submitted, reviewed]
  return (
    <article className="px-4 py-4 sm:px-5" data-work-status={item.status}>
      <div className="flex items-start gap-3">
        {item.status === 'waiting' ? <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken text-ink-muted"><Clock className="h-4 w-4" /></span> : <GradeChip grade={item.grade} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
            <Link to={blockPath} className="hover:underline">{item.lesson_title}</Link>
            {item.block_title !== item.lesson_title && <span className="font-normal text-ink-muted"> · {item.block_title}</span>}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted [overflow-wrap:anywhere]">{meta.filter(Boolean).join(' · ')}{item.attempt > 1 ? ` · attempt ${item.attempt}` : ''}</p>
          {item.feedback && <div className={`mt-2 border-l-2 pl-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere] ${item.status === 'redo' ? 'border-warning-line' : 'border-line-strong'}`}><MarkdownText content={item.feedback} /></div>}
          {item.status === 'redo' && item.submissions_closed && <p className="mt-1 text-xs text-ink-muted">Submissions are closed for this week.</p>}
          {item.status !== 'waiting' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.status === 'redo' && <LinkButton size="sm" to={blockPath}>{item.can_resubmit && !work.read_only ? 'Open and resubmit' : 'Read feedback'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
              {asked && !work.read_only && (
                <Button variant="secondary" size="sm" disabled={messenger.opening} onClick={() => void messenger.open(asked.id, { label: `Feedback on ${item.lesson_title}`, path: blockPath })}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />Ask about this feedback
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
