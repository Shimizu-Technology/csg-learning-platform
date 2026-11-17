import type { LessonEditAccess, LessonEditGrant } from '../types/api'
import { formatShortDate } from './format'

type GrantSource = Pick<LessonEditGrant, 'granted_by' | 'granted_at'>

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || 'An admin'
}

/** "Leon gave you this access on Nov 14" (or "…gave this access…" for an admin's view). */
export function grantLine(grant: GrantSource, audience: 'you' | 'them' = 'you') {
  const who = grant.granted_by ? firstName(grant.granted_by.full_name) : 'An admin'
  const when = grant.granted_at ? ` on ${formatShortDate(grant.granted_at, '', { withYear: false })}` : ''
  return `${who} gave ${audience === 'you' ? 'you ' : ''}this access${when}`
}

export function cohortList(names: string[]) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The sharing cohorts as words: the ones the viewer may see by name, then the
 * rest as a number ("Cohort 4 and 1 other cohort"). The server never names a
 * cohort an instructor doesn't teach (L-3.2).
 */
export function sharingList(named: { name: string }[], othersCount = 0) {
  const parts = named.map((cohort) => cohort.name)
  if (othersCount > 0) parts.push(`${othersCount} other ${othersCount === 1 ? 'cohort' : 'cohorts'}`)
  return { text: cohortList(parts), count: named.length + othersCount }
}

/** The read-only explanation an instructor sees in the lesson editor and Content. */
export function readOnlyNotice(access: LessonEditAccess): { title: string; body: string } {
  if (access.reason === 'shared') {
    const mine = cohortList(access.grants.map((grant) => grant.cohort.name))
    const sharing = sharingList(access.shared_with, access.shared_with_others_count ?? 0)
    const others = sharing.text
    const grant = access.grants[0]
    // Older cached payloads have no copy_cohorts.
    const copyCohorts = access.copy_cohorts ?? []
    const copyFor = copyCohorts.length === 1 ? copyCohorts[0].name : 'your cohort'
    return {
      title: `Read only: ${others} ${sharing.count === 1 ? 'shares' : 'share'} this curriculum`,
      body: `You can edit ${mine}'s content. Make a copy for ${copyFor} to change this lesson without affecting ${others}.${grant ? ` ${grantLine(grant)}.` : ''}`,
    }
  }
  return {
    title: 'Read only',
    body: 'Only admins can edit lessons. Ask an admin to give you editing access for your cohort.',
  }
}

/** "You're editing Cohort 3's copy" once a cohort has its own copy of a shared curriculum. */
export function copyNotice(access: LessonEditAccess): { title: string; body: string } | null {
  if (!access.copy_of) return null
  // Null when this instructor doesn't teach the cohort the copy belongs to.
  const cohort = access.copy_of.cohort?.name
  if (!cohort) return { title: "You're editing a cohort's copy", body: `Later changes to the shared ${access.copy_of.source_curriculum?.name || 'curriculum'} don't reach it.` }
  return {
    title: `You're editing ${cohort}'s copy`,
    body: `${cohort}'s progress, submissions and release dates moved with it.${access.copy_of.source_curriculum ? ` Other cohorts keep the shared ${access.copy_of.source_curriculum.name}.` : ''}`,
  }
}
