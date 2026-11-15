# Shared web/native logic parity (N-2)

Implementation base: `b282acdb` (PR #247), branch `feat/shared-logic-parity`.
Agent executes affected-flow QA; synthetic users and local databases only.

CSG Learn serves students working through cohort curriculum and instructors reviewing
that work. Enrollment-scoped progress, reviewed submissions, knowledge checks and
recording access must remain distinct. Watch time cannot override evidence-controlled
completion. Sources: `docs/PRODUCT_VISION.md`, `docs/API_REFERENCE.md`,
`docs/qa/record-destination-2026-11-15.md` N-2 inventory, `ContentBlock`,
`EnrollmentCapabilities`, lesson and watch-progress controllers. No production state
or installed build was inspected or changed. No page layout files changed.

## Watch policy and compatibility

Both new clients use the native seek-rejection rule: a positive observed media delta
counts only while playing and when it is at most wall seconds × max(rate, 1) + .75.
Background playback counts the observed delta; pause and implausible seeks count zero.
Ended moves the resume point to duration but never promotes watched seconds.
The playback modules are byte identical, checked by web tests.

The API uses the final Fix round 1 policy below. The original fractional-only
budget and replay-discard behavior were replaced after review. Enrollment write
locks serialize calculation and saving. Video replacement clears the clock and
tokens. Existing rows acquire a clock lazily; no historical-credit rewrite occurs.
Apply the clock migration before the API deployment.

## Inventory disposition and user-visible changes

- Video: web now rejects implausible seeks instead of awarding capped seek credit.
  Both new clients stop ended-duration promotion. Web waits for API completion
  instead of marking a video done optimistically on ended. API caps large claims
  and duplicate requests. Pure fixtures, component regression and API replays cover these changes.
- Submission type: expose the existing contextual server resolution as
  `effective_submission_type` in lesson/block payloads. Both clients prefer it;
  twin helpers retain fallback for older payloads. Native no longer turns a
  non-exercise into GitHub work merely because the module requires GitHub.
  The exhaustive server legacy table covers block kind, filename, lesson review
  requirement, prework and GitHub flag, plus explicit-type precedence.
- Learner status: keep client presentation local; shared precedence fixtures cover
  redo, awaiting review, completion, availability, closure and partial progress.
  Web now treats a missing grade as awaiting review, matching native. Moving
  composed lesson presentation onto the API would expand this change unnecessarily.
- Enrollments: no algorithm change. Both helpers select active alumni enrollments
  identically. Fixtures cover empty, paused, alumni-only and mixed enrollments.
  Expiration/access decisions already belong to `EnrollmentCapabilities`; these
  classification helpers must not infer access from client dates.
- Private meetings: native invalid course dates now return null, matching web.
  Fixtures include Guam midnight/week boundary and invalid dates. API already
  returns slot `available` and `bookable_week_numbers` and enforces booking/change
  rules. Keep local display/time calculations; native's additional explicit
  end-date argument is intentional and has no web counterpart.
- Segments: no drift in normalization or overlapping-range union; shared fixtures
  cover ordering, numeric strings, invalid ranges, optional and overlapping parts.
  Keep local seek/display helpers for older metadata. No server migration needed.
- Uploads: native now resolves known extensions with absent/generic MIME just like
  web. Twin pure MIME/size policy and shared boundary fixtures prevent drift.
  API/storage already enforce content type and the 1-byte–5-GiB limit; native
  file access and browser File objects remain platform specific.
- Message format/plain text: no rendering policy change. New common Markdown
  fixtures supplement existing `fixtures/markdown-excerpts.json` and parser parity
  tests in both suites. Rich-editor serialization and native link handling have
  different platform purposes and stay separate.
- Message normalization: the inventory's named files actually normalize Markdown,
  rather than pagination state. Shared fixtures preserve fenced/indented code and
  remove empty markers. Additional shared message-state fixtures cover overlapping
  pagination, equal timestamps and deleted pins through each platform's adapter.
  No semantic change was required for those cases.

## Real browser acceptance

Local PR #227 harness, Chromium shared preview, synthetic student 3, lesson 1;
generated 24-second H.264 color video. Only media URL delivery was stubbed to the
local file; lesson reads and progress writes used the real API/database. No provider
video/device runs. Viewport sizes are responsive browser coverage, not native devices.

| Required case | Result / saved evidence |
| --- | --- |
| Playback 1× and 2× at 1280 | Passed: reports/API totals 8 then 20 of 24; incomplete. |
| Forward seek to ended at 1280 | Passed: resume 24, credit 21; API in_progress and UI Mark done. |
| Playback 1× and 2× at 390, fresh progress | Passed: position/credit 3 then 7; API in_progress. |
| Forward seek to ended at 390 | Passed: resume 24, credit remains 7; API in_progress, UI Mark done. |
| Further real playback earns completion | Passed: credit capped at 24, API completed, UI Done at both widths. |
| Submission-type exercise at both widths | Passed: authoritative text_submission, same reviewed submission and rubric; no horizontal overflow. |

The first 390 reset was invalidated by an unmount progress save. It was discarded;
the table records the fresh run after unmounting before resetting the database.

## Verification and cleanup

Web: both TypeScript projects, ESLint, full Vitest, build and test:bundle.
Mobile: Node 22.22.3 typecheck, lint (existing warnings), full Jest; iOS/Android
`npx expo export --platform ios --platform android`. Default all-platform export
also attempted: native bundles built, web failed resolving the existing Expo SQLite
`wa-sqlite.wasm` asset. Native devices and WebKit are not run on this machine.
API: local branch DB, `PGGSSENCMODE=disable`, one test worker; full Minitest,
RuboCop, Brakeman and zeitwerk:check. Final counts/status are in the PR.

Regression experiment temporarily restores old implementations and runs the new
cases, then restores the implementation. Old code failed two web cases (ended credit and missing grade), four native cases
(ended credit, invalid meeting date, absent upload MIME, GitHub fallback), and both
API endpoint replay cases (75 seconds became 1000 on ended). Restored targeted
suites pass.

Preview tab closed; harness identity-checked API/Vite processes stopped; generated
video removed; harness database dropped. The branch test DB is dropped after final
verification. No shared services were stopped. Lifecycle helper could not initialize:
`Invalid machine profile: schema_version must be 1`; exact harness ownership records
were used instead. Branch/checkout retained for review; no merge or PR watch.

Final implementation tested: `6cc46b7a` (documentation-only commit follows).
API: 1,211 tests / 9,087 assertions, zero failures/errors/skips. Web: 156 files /
1,735 tests passed on Node 20.19.5; both tsc projects, lint, build and bundle gate
passed. Native: 126 suites / 1,144 tests passed on Node 22.22.3; typecheck and lint
passed (33 warnings). iOS/Android exports passed. RuboCop clean (530 files),
Brakeman zero security warnings, Zeitwerk clean. Impeccable advisory returned `[]`.
Independent reviewer/CI coverage remains for the PR integration owner.

## Fix round 1

Base verified: `9354a6df`; fetched, pulled ff-only and merged `origin/main`
(already current). Agent-executed affected-flow acceptance; local synthetic data.
The following policy supersedes the original watch policy and verification counts.

Final credit policy:
- Start each row with 20 media seconds, once. Refill at two media seconds per
  elapsed server second. Save up to 20 unused tokens (including fractions) after
  each debit; this keeps granted credit bounded by 2 × server time + 20.
- Outstanding reported totals remain recoverable against the accepted server
  total. Repeated totals can spend available tokens, never create tokens. This
  also recovers installed native counters stalled at duration (102/120 → 120).
- Both new clients send payload `watch_credit_version: 2` to both endpoints.
  For marked gaps longer than 30 seconds (three normal save windows), replace
  the available idle budget with 20 seconds. Unmarked installed clients retain
  uncapped idle refill for background resume. **Residual: a forged post after
  long idle can complete a legacy row.** Remove this exception as old builds age out.
- New clients report nonnegative, floored totals without a duration clamp.
  The server still caps accepted credit at duration and never reduces stored
  credit. Ended sets resume position only; reviewed-work completion remains separate.
- The first-post allowance changes from 25 to the same 20-token cap. Delayed
  first-post debt is recoverable; tests include two failed initial saves.
- After more than five seconds without a playback update, only a media delta
  matching continuous playback at the selected rate (±.75 seconds) bridges the
  gap. This rejects the 10→60 control-bar scrub after a 60-second stall in both
  twins while retaining the continuous background-playback fixture.

Other findings: the native recording picker now uses `videoContentType`, covered
through the actual screen with octet-stream MOV/MP4 assets. Submission-type tests
that supply resolved values are renamed as transport-contract tests; they do not
claim to test the server truth-table resolver. Existing fallback tests remain.
Lesson serialization resolves the effective submission type once per block.

Regression proof against the original head: temporarily restoring its service
makes the stalled-counter test fail (102 vs 120) and the alternating-arrival test
fail (293 vs 300). Restoring original twin helpers fails two web fixtures and two
native fixtures; restoring the upload screen fails both MIME-selection screen
cases. Implementations restored afterward. The latency matrix covers 200 seeds
per old-web/old-native pattern, .5/1/1.5/2×, marked/unmarked, and successful/delayed
first saves (6,400 sessions). Endpoint tests prove marker handling for both routes.

Chromium browser rerun at 1280×800: real 24-second generated H.264 file; only the
stream URL response stubbed, real lesson/progress API and local DB. At 1× the
server saved 5 seconds, then at 2× saved 13; forward seek to 23 and ended saved
14/24, status in_progress. Seek back and further 2× playback reported 26, accepted
24, status completed, UI Done. No fake clock or synthetic timeupdate events.
Native devices, mobile Safari and WebKit not run on this head.

Owned preview tab closed; identity-tracked QA servers stopped and harness DB
removed with `scripts/qa/run clean`; generated video removed. Shared PostgreSQL
left available. Lifecycle helper still rejects the machine profile with
`Invalid machine profile: schema_version must be 1`; exact harness ownership
records were used. No merge, deployment or PR watch.

Final round-1 gates: API 1,217 tests / 22,129 assertions, no failures/errors/skips;
RuboCop 530 files clean, Brakeman zero warnings (one existing ignored warning),
Zeitwerk clean. Web Node 20.19.5: both TypeScript projects via `tsc -b`, lint,
156 Vitest files / 1,737 tests, build, bundle and Netlify checks passed. Native
Node 22.22.3: typecheck, lint (existing warnings), 127 Jest suites / 1,148 tests
passed. Separate iOS and Android exports with CI's exact platform arguments
passed. Impeccable advisory `[]`. CI and independent review of the pushed fix
remain for the integration owner; this report does not claim final-head approval.
