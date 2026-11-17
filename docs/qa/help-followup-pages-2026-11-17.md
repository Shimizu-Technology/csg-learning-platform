# Help request and follow-up pages (W7 PR 7.4)

Agent-executed affected-flow QA on 2026-11-17, tested at commit dd24e07d (branch `feat/help-followup-pages`, merged with origin/main at 51b0d7ce). Backlog items: U-4.7 (help-request card), L-2.5 (help request and follow-up pages), and the help-request and follow-up parts of L-5.1.

Purpose: staff answer a learner's help request without being forced to close it, and can move between a request, the follow-up plan started from it, the plan's evidence and the conversation without losing their way back.

Environment: the local QA harness (`scripts/qa/run start`) with synthetic data only, plus `scripts/qa/help-followup-fixtures.rb`. Chromium only, at 1280×844 and 390×844, in light and dark. The spec is `scripts/qa/help-followup.spec.ts` (`QA_SPEC=help-followup.spec.ts`). Each screen is checked for sideways scroll and serious axe violations (gated) and colour contrast (recorded).

## Result

12 of 12 runs passed: three journeys × two widths × two themes. Across the 24 recorded screens there was no sideways scroll, no serious axe violation and no contrast finding.

| Journey | Persona | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- | --- |
| Support card: Reply keeps the request open, then Reply & resolve closes it | Instructor | Pass | Pass | Pass | Pass |
| Request page: Reply, follow-up plan link, and Back to the request | Instructor | Pass | Pass | Pass | Pass |
| Follow-up page: linked evidence, return plan link, Message with its source and back | Admin | Pass | Pass | Pass | Pass |

## What each journey checked

**Support card (U-4.7).** A request card shows Reply, Reply & resolve, Open request and the lesson link, and no Acknowledge or Student context. Reply opens an inline box. "Send reply" showed "Reply sent. The request stays open.", the card stayed with a reply count, and the API reported the request `acknowledged` with the reply text. Reply & resolve then showed "Reply sent and request resolved.", the card left the active list, and the API reported it `resolved`.

**Request page (L-2.5, L-5.1).** Opened from Support, the back link read "Back to Support". Send reply added the reply to the thread and kept the composer. The header's "Follow-up plan · Open" link opened the plan, whose back link read "Back to Help request · QA Behind", and that link returned to the request.

**Follow-up page (L-2.5, L-5.1).** Opened with `return_to=/admin/support`, the back link read "Back to Support". The saved submission id rendered as a link to `/admin/submissions/:id?cohort_id=…&student_id=…&return_to=…`. Following it opened the submission with "Back to Follow-up plan · …", which returned to the plan. The return plan card links to the student page's Support tab (`?plan_id=`). Message opened `/messages/dm/:id?source_type=intervention…` with a "From follow-up plan: …" chip that links back to the plan.

## Found and fixed during QA

- **Follow-up page, all widths:** the owner / next follow-up / created-by summary put `<dt>`/`<dd>` outside a `<dl>`, a serious axe `dlitem` violation. This was already on main. The summary is now a `<dl>`.
- **Support "Needs attention" rows at 390px:** the student's name and reason were squeezed to one letter per line next to the Message and next-action buttons. This was already on main (shared `AttentionRow`). The name column now takes the line and the actions wrap below it. Checked by screenshot at 390 after the fix.

## Not run, and limits

- Native app (Expo): not run on a device or simulator; this machine has none. Mobile is covered by typecheck and jest, including a new Reply / Reply & resolve test on the staff request screen.
- WebKit / Safari: not run (WebKit doesn't start on this machine).
- Learner view: the learner's help sheet showing replies is covered by API tests (learners get `replies`, never `follow_up`) and by type checks, not by a browser pass.
- Push and email delivery: not exercised. The harness queues jobs without running them. The API suite checks one push per reply, sent after commit, with the inline adapter.
- The harness's synthetic student and cohort are both named "QA Program", so that name appears twice in the follow-up page's breadcrumb. This is fixture naming, not a bug.

## Fix round 1 re-test

Agent-executed on 2026-11-17 against the fix-round-1 code (commit 3040b842 plus its QA fixture and spec changes), after merging origin/main at c62eb42a (#279 Updates composer, #281 grading workbench). Same harness, Chromium, 1280 and 390, light and dark.

**Result: 24 of 24 runs passed.** That is six journeys × two widths × two themes: the three journeys above, re-run after the merge, plus three new ones below. None of the 36 recorded screens had sideways scroll, a serious axe violation or a contrast finding.

| Journey | Persona | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- | --- |
| Lost response, retried: one reply saved | Instructor | Pass | Pass | Pass | Pass |
| Resolved request shows every reply | Learner | Pass | Pass | Pass | Pass |
| Source that no longer resolves stays as text | Admin | Pass | Pass | Pass | Pass |

**Retry path.** The request page's first "Send reply" reached the server and was saved, but the browser dropped the response (Playwright `route.fetch()` then `abort('connectionreset')`). The draft stayed in the box. Pressing "Send reply" again sent the same `client_request_id`. The server returned the saved reply, the API showed exactly one new reply, and the page showed it once.

**Learner thread.** An instructor replied with Reply, then an admin used Reply & resolve. As the learner, opening help on that lesson showed "Previous replies" with both replies. Before this fix, only the final reply showed.

**Unresolved source.** For a plan whose saved help request and lesson ids no longer exist, the "Why this plan started" section shows "Help request #987654" and "Lesson #987653" as plain text, not links. Before this fix, both ids disappeared.

Push and email delivery for a replayed reply are not exercised in the browser. The API tests cover them: a sequential retry and two concurrent copies each notify the learner once.

## Cleanup

After each pass, the harness servers were stopped and the harness database dropped (`scripts/qa/run clean`). The temporary worktrees used to confirm the new tests fail on the old code were removed, along with their databases.
