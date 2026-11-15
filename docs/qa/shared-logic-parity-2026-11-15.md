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

The API independently grants min(new reported media seconds, floor(2 × server elapsed
seconds + fractional carry)). A progress row without a clock gets a single 25-second
bootstrap allowance, covering older players' first ten-second save at 2× with rounding.
It is not granted again on each post or on each viewing session. Unused whole seconds
are discarded; fractional seconds survive. Background gaps are not capped. Reports
never decrease saved credit. Identical cumulative replays earn nothing; discarded
excess cannot be reclaimed by replaying the same report. A lower report can start a
new client session from the saved server total. Credit is capped at duration without
reducing existing saved credit. Resume position is independent of credit.

Enrollment write locks serialize the calculation and save. Content-video replacement
clears the clock alongside watch metrics. Existing rows acquire their clock lazily;
there is no historical-credit rewrite. Migration adds three columns to each progress
table. Deploy the API migration before relying on the new behavior.

Installed mobile builds keep their algorithm and cumulative posting format. Both
endpoints replay old web and native posts at .5, 1, 1.5 and 2×, including first play,
periodic saves, a 120-second background gap, pause/foreground and ended promotion.
Honest observed playback is credited; oversized ended promotion is clamped with a
successful response. The server bounds claims; server time cannot prove that a
human actually watched, and the bootstrap intentionally allows up to 25 seconds on
a first report. Completion still requires 90% of duration and preserves reviewed
work/checkpoint evidence.

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
