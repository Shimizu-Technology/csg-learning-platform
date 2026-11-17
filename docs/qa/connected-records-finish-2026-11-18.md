# Connected records, finish (L-5.2, L-3.2, L-2.9) QA, 2026-11-18

Affected-flow QA for the last L-5.2 record pages, the rest of L-3.2's "where used" relationships and the rest of L-2.9. Executed by the implementation agent on Leon's MacBook. Branch `feat/connected-records-finish`, based on main `08236d2e`. Synthetic data only.

## What was already done, and what this PR does

| Backlog item | State on main `08236d2e` | This PR |
| --- | --- | --- |
| L-5.2 return plan (recovery plan) | A section on the follow-up plan and the student's Support tab; the route registry pointed at Support | `/admin/recovery-plans/:id`: owner (flagged when they no longer teach the cohort), pace, scope, cadence, next and last follow-up, outcome, the follow-up plan or restart it came from, the newest 20 notes. Editing stays on Support. Staff in the plan's cohort only. |
| L-5.2 staff member | Team member page from #278/#287 (record header, related panel) | Brought to the record contract: Back on loading, error and No access, `return_to` honored (registry `staff` now `returnTo: any`), safety row. |
| L-5.2 moderation item | Report cards on Safety only | `/admin/moderation/reports/:id`, admins only: reason, quoted message, where it was posted, the people with their safety counts, blocks between them, other reports about the same person, Reviewing / Actioned / Dismiss. Each Safety card links to it. |
| L-5.2 message permalink | Web "Copy link to message" since L-2.8 (verified in #290) | Mobile conversation and thread sheets gain "Copy link to message", copying the same web address. It opens back in the app at the message (`/conversation/<kind>/<id>?message_id=`). Access is still the conversation's own check. |
| L-3.2 offering → purchases → enrollments | Nothing for staff | `/admin/offerings/:id` (admins): terms, counts by status, paid total, purchases 25 at a time newest first on a stable id cursor, each buyer linked to their enrollment. Linked from the offering settings and the cohort's related panel. |
| L-3.2 reported message → conversation | Safety card link (#278) | Same rule moved into `ContentReportConversation` and reused by the report page. |
| L-3.2 person → reports and blocks | Nothing | `PersonSafety` counts on the team member page and (admins only) the student related panel; Safety filters to one person (`?person_id=`, API `user_id`). |
| L-3.2 announcement → readers | Done in #299 (`read_summary`, aggregated) | No change. |
| L-3.2 lesson → activity | Nothing | Lesson page "Learner activity": count and ten newest events in the cohorts the viewer can see, each passing the activity event page's own check. |
| L-3.2 course packages | Preview said only "assigned" | Preview names the curriculum it updates and the cohorts and offerings using it; the curriculum page shows the package key. |
| L-2.9 watch progress Back | Fixed to the Learning tab in #268 (`ca778caa`) | Back is now origin-aware: from Recordings or a recording page it returns there; Learning stays the fallback. Back also shows while loading. |
| L-2.9 instructor `?tab=team`, `/settings` | Fixed in #268: overview, and overview with a settings notice | Verified (case 9). |
| L-2.9 recordings "by Unknown", progress link | Fixed in #268 | Verified (case 9). |
| L-2.9 Manage cohort link back | Manage cohort merged into the cohort workspace in #268 | Nothing to link. |
| L-2.9 notification bell | Staff shell bell with unread badge since #268 | Verified (case 9). |
| L-2.9 announcement cohort/author | Done in #279 | No change. |

## Environment

- Harness: `scripts/qa/run start` (Rails test mode and Vite on loopback, fresh `csg_qa_55414_1794941829`), then `scripts/qa/connected-records-finish-fixtures.rb`.
- Fixture: a return plan for persona 4 from their seeded follow-up plan; persona 3 reports a class-chat message and a DM from persona 4 and blocks them; lesson activity; "QA Finish Other Program" on the same curriculum, taught only by "QA Finish Other instructor", with its own plan, report and activity; 30 purchases on QA Self paced (27 paid and enrolled); a course package imported and used by "QA Package Cohort".
- Browser: Playwright Chromium at 1280 and 390, light and dark (`QA_SPEC=connected-records-finish.spec.ts`). Each recorded page checks no sideways scroll, no serious axe violations and no contrast violations.
- Personas: admin (1), QA instructor (2, teaches QA Program, not QA Finish Other Program).

## Results

36 of 36 cases passed (9 scenarios × 2 widths × 2 themes). The first full run passed 32 of 32; after a copy change on the offering page and the new L-2.9 scenario, the affected scenarios were rerun (12 of 12).

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Instructor opens the return plan from the student's Support tab ("Plan page"): title, Follow-up due, pace, three notes newest first, Back to the student. The owner has no team link (admin-only page). The Follow-up plan row opens the follow-up plan; its "Plan page" comes back with "Back to Follow-up plan · QA Behind". | Passed |
| 2 | Instructor opens QA Finish Other Program's return plan by URL: No access with Back to Support, no other-cohort name. Both report pages and the purchases page: No access. The lesson's activity lists only QA Program's two events. | Passed |
| 3 | Admin opens a report from Safety: quote, "QA Program blocked QA Behind", Back to Safety. "Open in #qa-class" opens Messages at the message. The reported person's safety line opens Safety filtered to them (2 reports, then their block), and "Show everyone" clears it. A DM report the admin isn't in stays a quote and a label, with no Messages link. | Passed |
| 4 | Forced 500 on a report: "Couldn't load this report" with Back to Safety; Try again loads it; Reviewing saves (checked in the database: `reviewing`, reviewed by the admin). | Passed |
| 5 | Admin opens Purchases from the offering settings: $1323.00 from 27 purchases, 25 rows, newest (not finished) first with "No enrollment"; Show more loads all 30; a buyer opens their student page; Back returns to Settings. | Passed |
| 6 | Admin: the behind student's related panel "Open reports about them" opens Safety filtered to them; the instructor's team page shows the row without a link (nothing reported). The lesson page lists three activity events (both cohorts for the admin); an event opens with "Back to Lesson · QA Lab 1.1.1". | Passed |
| 7 | Admin previews the imported package again: "Imported as Python recording package", "Used by one cohort" with a link to QA Package Cohort; the curriculum link opens its page, which names the package key. | Passed |
| 8 | Instructor: Watch progress from the Recordings tab shows "Back to Recordings" and returns there. | Passed |
| 9 | Instructor: `?tab=team` shows the cohort overview, `/settings` lands on the overview with the settings notice (not Recordings), Recordings has no "by Unknown" and links Watch progress, and the shell has the Notifications bell to the inbox. | Passed |

Spec fixes during the run (not app defects): Back labels carry the origin's own label ("Back to QA Behind", "Back to Lesson · QA Lab 1.1.1"); the forced failure had to hold until Try again because dev StrictMode loads twice; the blocks locator. The package preview's axe check excludes Content's module drag handles behind the dialog (`.cursor-grab`, `aria-prohibited-attr`), which this PR doesn't touch; noted as a residual.

## Automated checks

- API: new `ConnectedRecordsFinishTest` (10 tests); QueryCounter tests whose fixtures really grow for the return plan (15 → 15 queries), report (19 → 19) and offering (13 → 13, past one page); lesson usage and the team member page now also grow activity, reports and blocks and stay flat. OpenAPI updated and contract tests pass. Full suite both modes on ASUS: see the PR.
- Web: typecheck, lint, 244 files / 2,888 Vitest tests, build. Advisory Impeccable scan of the changed pages: no findings.
- Mobile: typecheck, lint (existing warnings only), 142 suites / 1,551 Jest tests, including the permalink round trip.

## Not run or out of scope

- WebKit / Safari, and the native app on a device: not run. The mobile copy action is unit-tested, not tapped on a phone.
- Stripe: purchases are synthetic rows; no checkout ran.
- Message bodies on the report page follow Safety's existing rule (admins see the reported text, 500 characters). An admin who has a block with the reported person still sees it, as on Safety today. Decision for Leon if that should change.
- Safety's existing lists still page by offset on `created_at`/`resolved_at` (unchanged here).

## Cleanup

The harness servers (PIDs 61786, 61826) were claimed and stopped, and the QA database dropped (`scripts/qa/run clean`). The focused local test database `csg_crf_focus_test` was dropped. `dev-lifecycle status` shows no owned resources.
