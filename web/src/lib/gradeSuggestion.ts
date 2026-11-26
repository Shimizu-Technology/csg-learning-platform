import type { BadgeTone } from '../components/ui/Badge'
import { humanize } from './glossary'
import type { SubmissionGradeSuggestion } from '../types/api'
import { gradeChoicesFor, type GradeChoice } from './gradingScale'

export type { GradeChoice } from './gradingScale'
export type SuggestionOutcomeFilter = 'all' | SubmissionGradeSuggestion['outcome']

/** Older evidence and changed check rules are one state to graders: "Out of date". */
export const STALE_SUGGESTION_LABEL = 'Out of date'
export const STALE_SUGGESTION_EXPLANATION =
  'The student pushed new code or the check rules changed. Check GitHub again before using this suggestion.'
/** One-tap override notes for the most common reasons a grade differs from the checks. */
export const OVERRIDE_REASON_PICKS = ['Manual review found issues', 'Checks flaky', 'Partial credit'] as const

export interface ParsedSuggestionCheck {
  name: string
  status: 'passed' | 'failed' | 'pending' | 'missing' | 'untrusted' | 'other'
  label: string
  tone: BadgeTone
  appSlug: string | null
  detailsUrl: string | null
}

const CONCLUSION_LABELS: Record<string, string> = {
  success: 'Passed',
  failure: 'Failed',
  neutral: 'Neutral',
  cancelled: 'Canceled',
  skipped: 'Skipped',
  timed_out: 'Timed out',
  action_required: 'Action needed',
  startup_failure: 'Could not start',
  stale: 'Out of date',
}

/**
 * Out of date: the server says so, or (with the submission's `gradingScale`) the suggested grade
 * isn't on the curriculum's current scale, such as B after a switch to Pass / Redo.
 */
export function isGradeSuggestionStale(suggestion: SubmissionGradeSuggestion, gradingScale?: string | null): boolean {
  return Boolean(
    suggestion.stale ||
      suggestion.stale_for_current_policy ||
      suggestion.outcome === 'stale_evidence' ||
      suggestionOffScale(suggestion, gradingScale),
  )
}

function suggestionOffScale(suggestion: SubmissionGradeSuggestion, gradingScale?: string | null): boolean {
  const suggested = suggestedPassingGrade(suggestion)
  return Boolean(suggested && gradingScale && !gradeChoicesFor(gradingScale).includes(suggested))
}

/** The passing grade checks suggest: B on A / B / C / Redo (suggest_b), Pass on Pass / Redo (suggest_pass). */
export function suggestedPassingGrade(suggestion: SubmissionGradeSuggestion | undefined | null): 'B' | 'P' | null {
  if (suggestion?.outcome === 'suggest_b') return 'B'
  if (suggestion?.outcome === 'suggest_pass') return 'P'
  return null
}

function suggestedGradeName(suggestion: SubmissionGradeSuggestion): string {
  return suggestedPassingGrade(suggestion) === 'P' ? 'Pass' : 'B'
}

export function canSelectSuggestedGrade(suggestion: SubmissionGradeSuggestion | undefined, gradingScale?: string | null): boolean {
  return Boolean(suggestion && suggestedPassingGrade(suggestion) && !isGradeSuggestionStale(suggestion, gradingScale))
}

export function gradeDiffersFromSuggestion(
  suggestion: SubmissionGradeSuggestion | undefined,
  grade: GradeChoice | null,
  gradingScale?: string | null,
): boolean {
  if (!suggestion || !grade || isGradeSuggestionStale(suggestion, gradingScale)) return false
  const suggested = suggestedPassingGrade(suggestion)
  if (suggested) return grade !== suggested
  if (suggestion.outcome === 'review_for_redo') return grade !== 'R'
  return false
}

export function gradeSuggestionQueueBadge(suggestion: SubmissionGradeSuggestion, gradingScale?: string | null): {
  label: string
  tone: BadgeTone
} {
  if (isGradeSuggestionStale(suggestion, gradingScale)) return { label: STALE_SUGGESTION_LABEL, tone: 'warning' }
  if (suggestedPassingGrade(suggestion)) return { label: `${suggestedGradeName(suggestion)} suggested`, tone: 'info' }
  if (suggestion.outcome === 'review_for_redo') return { label: 'Review for Redo', tone: 'warning' }
  return { label: 'No suggestion', tone: 'neutral' }
}

export function gradeSuggestionHeadline(suggestion: SubmissionGradeSuggestion, gradingScale?: string | null): string {
  if (isGradeSuggestionStale(suggestion, gradingScale)) return 'Check suggestion'
  if (suggestedPassingGrade(suggestion)) return `Checks passed · ${suggestedGradeName(suggestion)} suggested`
  if (suggestion.outcome === 'review_for_redo') return 'Checks failed · Review for Redo'
  return 'No grade suggestion'
}

export function gradeSuggestionSignalLabel(suggestion: SubmissionGradeSuggestion, gradingScale?: string | null): string {
  if (isGradeSuggestionStale(suggestion, gradingScale)) return 'Checks out of date'
  if (suggestedPassingGrade(suggestion)) return 'Checks passed'
  if (suggestion.outcome === 'review_for_redo') return 'Checks failed'
  return 'No suggestion'
}

export function gradeSuggestionDecisionBadge(decision: NonNullable<SubmissionGradeSuggestion['decision']>): {
  label: string
  tone: BadgeTone
} {
  if (decision === 'accepted') return { label: 'Accepted', tone: 'success' }
  if (decision === 'overridden') return { label: 'Overridden', tone: 'warning' }
  return { label: 'Dismissed', tone: 'neutral' }
}

interface RawRunEvidence {
  name?: unknown
  status?: unknown
  conclusion?: unknown
  app_slug?: unknown
  details_url?: unknown
}

interface RawUntrustedEvidence {
  name?: unknown
  app_slug?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function parseRunEntry(name: string, run: RawRunEvidence): ParsedSuggestionCheck {
  const status = asString(run.status)
  const conclusion = asString(run.conclusion)
  const appSlug = asString(run.app_slug)
  const detailsUrl = asString(run.details_url)

  if (status && status !== 'completed') {
    return { name, status: 'pending', label: 'Pending', tone: 'pending', appSlug, detailsUrl }
  }
  if (conclusion === 'success') {
    return { name, status: 'passed', label: 'Passed', tone: 'success', appSlug, detailsUrl }
  }
  if (conclusion === 'failure') {
    return { name, status: 'failed', label: 'Failed', tone: 'danger', appSlug, detailsUrl }
  }
  const label = conclusion ? humanize(conclusion, CONCLUSION_LABELS) : 'Pending'
  const tone: BadgeTone = ['timed_out', 'startup_failure', 'action_required'].includes(conclusion || '')
    ? 'danger'
    : 'pending'
  return { name, status: conclusion ? 'other' : 'pending', label, tone, appSlug, detailsUrl }
}

export function extractSuggestionChecks(suggestion: SubmissionGradeSuggestion): ParsedSuggestionCheck[] {
  const evidence = suggestion.evidence && typeof suggestion.evidence === 'object' ? suggestion.evidence : {}
  const requiredChecks = asStringArray(evidence.required_checks)
  const missingSet = new Set(asStringArray(evidence.missing_checks))
  const untrustedMap = new Map<string, string | null>()
  if (Array.isArray(evidence.untrusted_checks)) {
    for (const item of evidence.untrusted_checks as RawUntrustedEvidence[]) {
      if (item && typeof item === 'object') {
        const name = asString(item.name)
        if (name) untrustedMap.set(name, asString(item.app_slug))
      }
    }
  }
  const runsByName = new Map<string, RawRunEvidence>()
  if (Array.isArray(evidence.runs)) {
    for (const item of evidence.runs as RawRunEvidence[]) {
      if (item && typeof item === 'object') {
        const name = asString(item.name)
        if (name) runsByName.set(name, item)
      }
    }
  }

  const orderedNames = requiredChecks.length > 0
    ? requiredChecks
    : [...new Set([...runsByName.keys(), ...missingSet, ...untrustedMap.keys()])]

  return orderedNames.map((name) => {
    const run = runsByName.get(name)
    if (run) return parseRunEntry(name, run)
    if (untrustedMap.has(name)) {
      return {
        name,
        status: 'untrusted',
        label: 'From an unapproved app',
        tone: 'warning',
        appSlug: untrustedMap.get(name) ?? null,
        detailsUrl: null,
      }
    }
    if (missingSet.has(name)) {
      return {
        name,
        status: 'missing',
        label: 'Missing',
        tone: 'neutral',
        appSlug: null,
        detailsUrl: null,
      }
    }
    return {
      name,
      status: 'other',
      label: 'Not recorded',
      tone: 'neutral',
      appSlug: null,
      detailsUrl: null,
    }
  })
}
