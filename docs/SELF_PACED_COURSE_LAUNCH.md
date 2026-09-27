# Self-paced focused courses: launch controls

This branch prepares course purchase and enrollment. **It does not open sales.** `COURSE_CHECKOUT_ENABLED` defaults to off, new Clerk signups remain closed in production unless `OPEN_COURSE_SIGNUPS` is explicitly enabled, and each course has its own `public_checkout_enabled` switch. No Stripe live key, public price, or course purchase terms are committed here.

## Course setup

Use one curriculum for the core lessons. Give its guided and self-paced offers separate cohorts. Set the self-paced cohort's `course_delivery` to `self_paced`, assign a staff `support_instructor_id`, keep the cohort active, and publish the curriculum only after videos, captions, exercises, answers, and the beginner rehearsal are complete. Do not put guided meeting instructions in shared curriculum blocks; use a guided cohort resource or separate guided orientation.

The self-paced cohort defaults to 12 months of lesson access from confirmed payment and six weeks of instructor messaging from the learner's first Dashboard or lesson open. The support deadline cannot exceed the lesson deadline. The self-paced workspace allows a direct conversation with its assigned instructor and hides group channels. The student cannot book private meetings. An instructor's target is two business days on published Guam support days. Staff should handle one active course question at a time; the current DM system does not enforce question-thread state or that response target.

Set `stripe_price_id` and `public_price_cents` only after the price is approved. The app checks the Stripe Price is active, one-time, USD, and matches the stored cents before opening Checkout. `public_checkout_enabled` must be true for the course to appear in the catalog, but sales stay disabled unless the environment switch is also on.

## Payment setup and activation gate

Use a separate Stripe sandbox for development and CI. Configure a restricted API key, a webhook signing secret, and `FRONTEND_URL`. Subscribe the webhook to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, and `charge.dispute.created`. Keep `STRIPE_WEBHOOK_SECRET` and the restricted key available while any Checkout session or refund can still arrive, even if new sales are turned off. The return page is informational; only a verified paid webhook grants access. A full refund or dispute removes purchased access. Partial refunds do not.

Before setting `COURSE_CHECKOUT_ENABLED=true` in production, approve the adult-only learner eligibility flow, purchase terms, refund policy, support days, tax treatment and required registrations, geographic sales scope, price, and access period. The proposed youth offer needs guardian consent and safeguarding work first. No automatic Stripe Tax setting is enabled here. Do not activate checkout by setting environment flags alone.

## Required rehearsal

The Netlify deploy preview is a frontend preview, **not** a complete staging environment. During September 27 browser QA, its `/courses` request could not reach the new route because the API still ran production code and did not allow the preview origin. The preview also used a production Clerk key that rejected the Netlify hostname. The page now shows a retryable unavailable state rather than treating that failure as an empty catalog. Do not use the public preview to claim authenticated catalog or checkout QA. Set up an approved staging hostname with a matching Rails branch/database, its own allowed CORS origin, and a Clerk environment authorized for that hostname; use Stripe sandbox credentials there. Keep production auth and CORS limited to their intended domains.

In the sandbox, test a new verified Clerk account with no bootcamp enrollment; open Checkout; return before the webhook; send a signed paid event; confirm one enrollment and all module assignments; open the course; confirm the support deadline; ask the assigned instructor a question; confirm the cutoff prevents another message; confirm a self-paced student cannot book a meeting; try another course; retry a failed asynchronous payment; process a full refund and a dispute; and verify a paid webhook still fulfills when new checkout is off. Use separate accounts to confirm one learner cannot access another learner's course.

The catalog route is `/courses`. Once that path, adult purchase terms, Stripe sandbox, and learner rehearsal are verified, the CSG site can link to it. The guided December pilot uses its existing invitation and payment process; this branch does not change that sale.
