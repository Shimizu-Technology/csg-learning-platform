# URL state and return to queue (L-0.6, L-0.7), 2026-11-15

W3 PR 3.3. Execution owner: implementation agent on the Mac mini, against the
local synthetic harness (`scripts/qa/run`). All data is synthetic.

## Acceptance

- Filters, search, the selected item, the active tab and open modules/weeks
  live in the URL on Learn, Recordings, Grading, Support, Cohorts, Students,
  the cohort roster, Team, Content and the module grading page. Browser Back
  restores them. Unknown or malformed values fall back to the default.
- Record pages opened from a queue show "n of N" with Previous/Next and the
  Back link to that list. Saving moves to the next item. The unsaved-draft
  guard runs on Previous/Next. J/K step through the queue outside text fields
  and dialogs.
- Edge cases: last item, an item finished by someone else, a deep link with no
  queue, a queue the viewer can't open, an unsafe return path.

## Real UI check (Chromium, 1280 and 390)

| Role | Journey | 1280 | 390 |
| --- | --- | --- | --- |
| Admin | Cohorts filter → cohort → Back restores filter; Students search → student → Back restores search; Content module open survives reload | Pass | Pass |
| Instructor | Inbox filter → record → Back restores filter; grade three in a row with Save and next; draft guard on Next; Back to inbox | Pass | Pass |
| Student (program) | Learn filter and search → lesson → Back restores both; invalid filter falls back; Recordings opens | Pass | Pass |

Each run started with six ungraded synthetic attempts, posted through the
student API. The run turned up two defects, both fixed in this PR:

1. Typing straight after choosing a filter could drop the filter: the two hooks
   built on separate pending URLs. Covered by a unit test.
2. On a phone, Save and next opened the next review about 1000px down. It now
   opens at the top, and the end-of-queue notice is visible.

Excluded from the console-error check: Monaco's CDN load, which the test blocks
by design, and a duplicate-key warning in `CohortHomePanel`. That warning is on
`main` already (recurring office-hour occurrences share an event id) and is not
part of this change.

Not run: WebKit and mobile Safari (WebKit doesn't start on this machine), and
physical devices. The harness servers and database were stopped and dropped
after the run.

## Fix round 1 (review findings)

Same owner, harness and machine. A fresh synthetic database each run, with two
ungraded attempts from the seed and three open help requests posted through
the student API. Chromium only, at 390 and 1280. Grading and resolving were
run once, at 1280, because they use up the data.

| Journey | 390 | 1280 |
| --- | --- | --- |
| Record opened from Grading, type feedback, browser Back: the prompt appears, Keep editing stays on the record with the draft, a second Back plus Discard returns to Grading | Pass | Pass |
| Same draft, reload: the browser's own leave prompt appears and the draft stays | Pass | Pass |
| Inline review in the inbox (`?filter=all&submission=`), type, Back changes only the query: prompt appears, Keep editing keeps URL and draft | Pass | Pass |
| Help request, type a reply, close the dialog, Back and the student link: both prompt, the draft is still there when the dialog reopens | Pass | Pass |
| Help request Next: focus moves to the next request's heading | Pass | Pass |
| Resolve and next through three requests: focus on each heading, then on the "last request" notice; Save and next (Redo) through two submissions: focus on the review panel, then on the "last submission" notice | Not run (uses up data) | Pass |

Browser errors: none apart from the blocked Monaco CDN load, which also logs
an unhandled `Event` rejection. Those errors are filtered out only when a
blocked `cdn.jsdelivr.net/npm/monaco-editor` request is recorded in the same
test.

Harness note: under 20 ms synthetic typing, the rich editor sometimes drops a
keystroke. Five runs of an 8-try typing probe on the same harness dropped
characters on `main` (16 of 40 tries: 0, 0, 8, 7, 1), on the PR head before
this round (6 of 40: 0, 0, 1, 3, 2) and with this round (8 of 40: 1, 1, 1, 2,
3). It is not caused by this change. The scenario helper
retypes on a mismatch and logs it (once in the final run). A real person
typing doesn't hit this. It's worth a look on its own.

The harness servers and database were stopped and dropped afterwards.
