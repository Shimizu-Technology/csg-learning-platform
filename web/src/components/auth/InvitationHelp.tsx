import { Mail, MailOpen } from 'lucide-react'
import { AnchorButton, LinkButton } from '../ui/Button'
import { PRODUCT_NAME, SCHOOL_NAME } from '../../lib/brand'

export const INVITATION_HELP_EMAIL = 'codeschoolofguam@gmail.com'

/**
 * Shown on /sign-up when there is no invitation ticket and Clerk only allows
 * invited sign-ups: explains how to use the invitation link instead of a dead end.
 */
export function InvitationHelp() {
  const subject = encodeURIComponent(`${PRODUCT_NAME} invitation`)
  return (
    <section aria-labelledby="invitation-help-title" className="rounded-md border border-brand-line bg-surface-raised p-6 sm:p-8">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-ruby-50 text-ruby-700">
        <MailOpen className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 id="invitation-help-title" className="mt-5 font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink">
        Use the link in your invitation email
      </h2>
      <p className="mt-3 text-base leading-7 text-ink-secondary">
        {PRODUCT_NAME} accounts start from the invitation {SCHOOL_NAME} emails you. Open it and choose <strong className="font-semibold text-ink">Accept invitation</strong>. It brings you back here with your invitation attached and your email filled in.
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-secondary">
        Can’t find it? Check spam or promotions for an email from {SCHOOL_NAME}, or ask us to send a new one.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <AnchorButton href={`mailto:${INVITATION_HELP_EMAIL}?subject=${subject}`} variant="primary" size="lg" shape="brand" fullWidth>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Ask for a new invitation
        </AnchorButton>
        <LinkButton to="/sign-in" variant="secondary" size="lg" shape="brand" fullWidth>
          I already have an account
        </LinkButton>
      </div>
    </section>
  )
}
