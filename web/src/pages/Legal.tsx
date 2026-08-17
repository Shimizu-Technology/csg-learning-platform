import { Link } from 'react-router-dom'
import { ArrowLeft, GraduationCap, Mail, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

const updatedAt = 'August 17, 2026'
const privacyEmail = 'shimizutechnology@gmail.com'

function LegalShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-4 py-8 text-slate-950 sm:px-6 lg:py-14">
      <div className="mx-auto max-w-4xl">
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Legal navigation">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-extrabold text-slate-800 transition hover:bg-white/70">
            <ArrowLeft className="h-4 w-4" />CSG Learning
          </Link>
          <div className="flex flex-wrap gap-1 text-xs font-bold text-slate-600">
            <Link className="min-h-11 rounded-xl px-3 py-3 hover:bg-white/70 hover:text-primary-700" to="/privacy">Privacy</Link>
            <Link className="min-h-11 rounded-xl px-3 py-3 hover:bg-white/70 hover:text-primary-700" to="/terms">Terms</Link>
            <Link className="min-h-11 rounded-xl px-3 py-3 hover:bg-white/70 hover:text-primary-700" to="/account-deletion">Delete account</Link>
          </div>
        </nav>

        <article className="mt-8 overflow-hidden rounded-[2rem] border border-[#d8d1c4] bg-white shadow-[0_24px_80px_rgba(71,55,42,0.09)]">
          <header className="border-b border-slate-200 bg-[#17191f] px-6 py-10 text-white sm:px-10 sm:py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600"><GraduationCap className="h-6 w-6" /></div>
            <p className="mt-7 text-xs font-extrabold uppercase tracking-[0.2em] text-primary-300">{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.045em] sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">{intro}</p>
            <p className="mt-5 text-xs font-bold text-white/55">Effective and last updated {updatedAt}</p>
          </header>
          <div className="prose prose-slate max-w-none px-6 py-9 prose-headings:font-extrabold prose-headings:tracking-tight prose-a:text-primary-700 sm:px-10 sm:py-12">
            {children}
          </div>
        </article>

        <footer className="mt-6 flex items-center gap-3 rounded-2xl border border-[#d8d1c4] bg-white/75 p-4 text-sm text-slate-600">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary-700" />
          <span>Shimizu Technology operates CSG Connect for Code School of Guam.</span>
        </footer>
      </div>
    </main>
  )
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell eyebrow="Privacy" title="Privacy Policy" intro="This policy explains what CSG Connect handles, why it is needed for the classroom, and the choices available to students, instructors, and administrators.">
      <h2>Who operates CSG Connect</h2>
      <p>Shimizu Technology operates CSG Connect and the CSG Learning Platform for Code School of Guam. Privacy questions may be sent to <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.</p>

      <h2>Information we handle</h2>
      <ul>
        <li><strong>Account and identity:</strong> name, email address, profile image, role, cohort, sign-in identifiers, and optional GitHub username.</li>
        <li><strong>Learning records:</strong> lesson progress, submissions, grades, instructor feedback, checks, attendance-related activity, help requests, interventions, and recording progress.</li>
        <li><strong>Communications:</strong> messages, reactions, attachments, reports, moderation decisions, and notification preferences.</li>
        <li><strong>Device and diagnostics:</strong> push-notification tokens, app version, device identifiers used for notification registration, limited product analytics, and error diagnostics.</li>
        <li><strong>Optional media:</strong> photos or files you deliberately select, and microphone audio only when you choose voice transcription. A voice draft is editable and is not automatically sent as a message.</li>
      </ul>

      <h2>How we use information</h2>
      <p>We use information to authenticate authorized learners and staff, deliver coursework, track progress, provide feedback and support, operate class communications, send requested notifications, moderate safety reports, secure the service, diagnose failures, and improve the learning experience.</p>

      <h2>Service providers and sharing</h2>
      <p>We do not sell personal information. Information is shared only as needed with service providers that help operate the platform, including Clerk for authentication; Netlify, Render, Neon, and Amazon Web Services for hosting and storage; Expo, Google Firebase, and Apple for mobile delivery and notifications; PostHog for configured product analytics and diagnostics; Resend for email; GitHub for connected coursework; and an approved transcription provider when voice transcription is enabled. Information may also be disclosed when legally required or necessary to protect students, staff, or the service.</p>

      <h2>Security, retention, and deletion</h2>
      <p>Data is transmitted over encrypted connections and access is restricted by role. We retain active account and learning records for the educational program and retain limited records afterward when reasonably necessary for academic records, security, dispute resolution, legal obligations, or community safety. Retention may differ by record type.</p>
      <p>You may request deletion from the in-app Profile screen or through the <Link to="/account-deletion">account deletion page</Link>. We will verify the request and explain any information that must be retained. Deactivation alone is not treated as completion of a valid deletion request.</p>

      <h2>Your choices</h2>
      <p>You can control notification preferences, choose whether to share files or microphone audio, report content or users, block another user, and request account/data deletion. Device permissions can also be changed in Android or iOS settings.</p>

      <h2>Younger learners</h2>
      <p>CSG Connect is an enrollment-managed educational service and is not directed to children under 13. If a learner is under the age of majority, Code School of Guam may coordinate appropriate enrollment and consent with the learner and their parent or guardian.</p>

      <h2>Changes</h2>
      <p>Material changes will be reflected by a new effective date. When changes affect community participation, users may be asked to accept the updated terms before sharing new content.</p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell eyebrow="Community & service" title="Terms and Community Guidelines" intro="CSG Connect is a learning community. These terms keep classroom collaboration useful, respectful, and safe.">
      <h2>Authorized educational use</h2>
      <p>CSG Connect is provided to invited Code School of Guam students, instructors, and administrators. Keep account access private, provide accurate information, and use the service for legitimate learning, teaching, support, and community activities.</p>

      <h2>Community expectations</h2>
      <p>Do not post or send harassment, bullying, threats, hate, sexual or exploitative content, spam, scams, malware, illegal material, another person’s private information, or content that infringes intellectual-property rights. Do not impersonate others, bypass access controls, disrupt the service, or use classroom information outside its intended context.</p>

      <h2>Your content</h2>
      <p>You retain ownership of content you create. You give Shimizu Technology and Code School of Guam the limited permission needed to store, display, transmit, review, and process that content to operate the classroom, provide feedback and support, maintain safety, and comply with law.</p>

      <h2>Reports, blocking, and moderation</h2>
      <p>Use the in-app actions to report a message or user and to block unwanted direct interaction. Reports are reviewed by authorized staff. We may remove content, restrict communication, preserve evidence, suspend access, or take other proportionate action. Blocking does not prevent staff from accessing information needed for instruction, safeguarding, or moderation, and essential class announcements may still be delivered.</p>

      <h2>Learning records and availability</h2>
      <p>Coursework, feedback, and progress views support instruction but do not replace official decisions communicated by Code School of Guam. We work to keep the service reliable, but availability may be interrupted for maintenance, security, or circumstances outside our control.</p>

      <h2>Third-party services</h2>
      <p>Some features connect to services such as Clerk, GitHub, YouTube, Apple, Google, and notification or transcription providers. Their own terms may also apply when you use those features.</p>

      <h2>Ending access</h2>
      <p>You may stop using the app or request account deletion. Code School of Guam may restrict or end access when enrollment ends, these terms are violated, or action is reasonably necessary to protect the community or service. Applicable learning, safety, and legal records may be retained as described in the Privacy Policy.</p>

      <h2>Contact</h2>
      <p>Questions or appeals can be sent to <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.</p>
    </LegalShell>
  )
}

export function AccountDeletionPage() {
  return (
    <LegalShell eyebrow="Account control" title="Request account and data deletion" intro="You can ask us to delete your CSG Connect account and associated personal data without needing the app installed.">
      <h2>Request from the app</h2>
      <p>Open <strong>You → Privacy & account → Request account deletion</strong>. The app records a pending request for authorized staff to review.</p>

      <h2>Request by email</h2>
      <p>Email us from the address connected to your CSG account. Include the full name and email address on the account. Do not send a password, sign-in code, government ID, or other unnecessary sensitive information.</p>
      <p><a className="not-prose inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary-700 px-5 py-3 text-sm font-extrabold text-white no-underline hover:bg-primary-800" href={`mailto:${privacyEmail}?subject=CSG%20Connect%20account%20deletion%20request`}><Mail className="h-4 w-4" />Email a deletion request</a></p>

      <h2>What happens next</h2>
      <p>We will verify account ownership, confirm the scope, and process the request. Personal data associated with the account will be deleted unless a limited record must be retained for academic records, security, fraud prevention, dispute resolution, safeguarding, or another legal obligation. If retention is required, we will explain the category and reason.</p>
      <p>Submitting a request does not immediately delete or lock the account, and it does not delete another person’s messages or records.</p>
    </LegalShell>
  )
}
