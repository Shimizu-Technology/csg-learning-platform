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

The API uses the final credit policy below, updated after the seed-13 decision.
The original fractional-only budget and replay-discard behavior were replaced
after review. Enrollment write
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

Historical round-1 policy (superseded by Fix round 2):
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

## Fix round 2

Base `70563303`; fetched, pulled ff-only and merged `origin/main` (already current).
This policy supersedes Fix round 1.

Final credit policy (seed-13 follow-up, supersedes the round-2 marked cap):
- Each row starts with 20 media seconds once and refills at 2.5× server time
  since the last accepted post. After debit, retain up to 20 unused tokens,
  including fractions, for jitter. Idle refill is uncapped for all clients,
  marked and unmarked, preserving background playback and PiP.
- Outstanding cumulative reports remain recoverable. Stored totals are monotonic
  and clamped to duration; never zero or reject a session. Ended changes resume
  position only.
- Watch credit is an engagement signal, not tamper-proof. A determined student
  can forge progress after idle time on any client. The server bound stops
  over-crediting from bugs, replays and large instant jumps on recently active
  rows. Grants since the first save cannot exceed 2.5× elapsed server time + 20.
- Both clients still send `watch_credit_version: 2`. The client-asserted marker
  is telemetry only. It does not change the budget; omitting it cannot provide
  a different credit policy.
- Playback twins still credit any positive observed delta within the plausible
  wall×max(rate, 1)+.75 bound, even after a stall. Beyond-bound forward jumps earn
  zero and callers reset their baseline on every update, preserving protection
  against later credit for that jump. The 10→60 over 60 seconds fixture earns 50:
  that input is indistinguishable from honest partial playback. A separate
  beyond-bound stall/scrub fixture remains rejected.

Background compatibility evidence: `origin/main` native-video-player.tsx sets
`staysActiveInBackground = true`, `audioMixingMode = 'doNotMix'`, enables
`allowsPictureInPicture`, and deliberately skips its AppState background pause
while PiP is active. mobile/app.json enables background audio and the expo-video
plugin's background/PiP options. Voice-draft audio settings disable background
recording/playback for that separate feature; they do not establish that video
pauses. Build 47's exact source commit could not be identified in repository
release records/history; installed binary behavior is not claimed verified.
Given explicit PiP/background support on main, preserve legacy compatibility.

User-visible upload change: unknown files with neither recognized MIME nor extension
remain rejected, with “Choose an .mp4 or .mov video.” Known MP4/MOV extensions
still resolve absent/generic MIME. Screen tests cover both acceptance and rejection.
The unused `watch_reported_total` column was introduced by this PR; remove it from
its unmerged migration/schema plus writes, resets and test setup. No deployed
column removal or production data change was performed.

The deterministic arrival simulator was ported from the reviewer's sim.rb and
variants.rb, keeping old/new web/native timing, native queue coalescing, latency
tails, failures and pauses. The outage window now falls inside every duration,
including five-minute videos at 2×. Default CI uses 20 seeds per cell; reproduce
200 seeds with `WATCH_CREDIT_SEEDS=200 bundle exec rails test test/services/watch_credit_test.rb`.
The matrix spans 300/600/1800 seconds, four clients, 1×/2× and tail/outage/pauses
(14,400 sessions at 200 seeds). Explicit tests cover 35/45-second save gaps,
completion recovery, background refill with either marker, the seed-13 regression,
and duration-clamped forged completion after idle time.

### Historical round-2 verification (superseded by the follow-up below)

**Original failure:** placing the 45-second outage inside the actual playback window finds
one new-native 2× session below 90% on a five-minute video: seed 13 accepts
269/300 (89.67%). A diagnostic with only the cap disabled accepts 300/300.
The reviewer's original outage starts at 200+ seconds, after five-minute 2×
playback ends at 150 seconds. Its original placement passed all seeds but did not
exercise that case. The in-playback version was retained as a failing regression;
default CI includes seed 13. The lead subsequently removed the cap for all clients. The outage
placement and 90% acceptance threshold remain unchanged.

The standalone full expanded matrix ran all 14,400 sessions: only that cell has a
failure (1/200); all other cells have zero below 90%. Full Rails with 200 seeds:
1,220 tests / 30,966 assertions, one failure, zero errors/skips (the assertion
stops that test at the first failing seed). All other Rails tests passed.
RuboCop: 531 files clean; Brakeman: zero warnings, one existing ignored;
Zeitwerk: clean. Web: both TypeScript projects, ESLint, 156 Vitest files / 1,739
tests, build, bundle and Netlify checks passed. Mobile: typecheck, lint (33
existing warnings), 127 suites / 1,151 tests passed. Separate iOS and Android
exports passed; the only later native edit fixes test loading synchronization.
Impeccable advisory: `[]`. The initial new screen-test failure was a premature
click during loading; the final full mobile rerun passes after awaiting readiness.

Agent-executed Chromium shared-preview rerun used a real generated five-minute
H.264 file, synthetic student 3 / lesson 1, 1280×800. Only media URL delivery was
stubbed; progress reads/writes used the real local API/database. No fake clock or
synthetic media events. 1× saved 9, 19, 29 seconds. At 2× a fetch-layer simulated
45-second progress outage failed four saves (49, 68, 88, 109); the next real save
accepted 129/300, recovering credit. This is progress-request failure injection,
not whole-browser DevTools offline; video was locally buffered. Seek to 299 and
ended saved 142/300, API in_progress, UI Mark done. Seek back to 142 and genuine
2× playback later saved 285/300, API completed, UI Done. Browser acceptance passes;
it does not negate the native simulation failure. Native devices, Safari/WebKit
and installed build 47 are not run/verified on this machine.

Task-owned shared-preview tab closed; exact harness API/Vite processes stopped,
harness and branch test databases dropped; generated video removed. PostgreSQL
remains available as a shared service. Lifecycle initialization still fails with
`Invalid machine profile: schema_version must be 1`; harness PID/start signatures
provided exact ownership and cleanup. No merge, deployment or PR watch.

## Seed-13 follow-up — final acceptance

Base `1b5446f685dd6f903813c275574dfa17243f10c9`; agent-executed affected-flow
verification on the Mac mini. Only API code/tests and this QA record changed.
Acceptance: remove the idle cap for all clients, retain the 20-token carry and
2.5× refill, preserve monotonic/duration-clamped credit and client playback rules,
and pass the unchanged 14,400-session matrix including seed 13. All passed.
The final credit policy above records the accepted forgery residual.

Full Rails with `WATCH_CREDIT_SEEDS=200 PARALLEL_WORKERS=1`: 1,221 tests /
50,940 assertions, zero failures/errors/skips. The full expanded matrix has
0/14,400 sessions below 90% (minimum 90.33%); seed 13 accepts 300/300.
RuboCop: 531 files clean. Brakeman: zero warnings, one existing ignored.
Zeitwerk: clean. No client files or fixtures changed in this follow-up, so the
conditional web Vitest / both TypeScript projects and mobile typecheck / test
gates were not rerun. Prior round-2 client results remain historical evidence.

Both actual progress endpoints pass marked/unmarked background-resume tests;
service tests cover seed-13 full recovery, duration-clamped idle forgery, active
row replay bounds and the complete seeded matrix. No new browser/device run was
needed for this server budget change; prior device limitations still apply.

The first local full-suite attempt hit a `pg` fork segmentation fault; its exact
owned process was stopped. Serial execution exposed seed-data interference from
`db:prepare`; that run was stopped and the task database schema reloaded without
seeds. The final full-suite run above passed against the clean schema and final
code. No repository workaround or test exclusions were introduced.

Task database `csg_shared_logic_parity_idle_test` was dropped after verification.
No servers or browser tabs were started; all test processes exited or were stopped.
Shared PostgreSQL remains running. Guidance freshness check could not run because
`~/.config/shimizu-technology/agent-context.json` is absent; canonical synced skill
files were read directly. Lifecycle initialization fails with
`Invalid machine profile: schema_version must be 1` (the local profile is absent).
Resource ownership and exact cleanup were recorded manually. No merge, deployment
or PR watch. Independent final-head review and CI remain for the lead.
