# Record destination contract — W3 PR 3.4a

Base: main `29ce05b`. Implementation: `e2232a7` (API), `9adb52b` (clients),
plus the contract-test and documentation commit that contains this report.
Agent-executed affected-flow QA on the Mac mini, November 15, 2026.

CSG learners need their notification to open the relevant learning record;
staff need the review/support record. Clerk access checks remain at the API
and destination pages. The descriptor is navigation metadata, never access
permission. Existing activity access checks run before emitting a destination.
Sources: `docs/PRODUCT_VISION.md`, the notification model/delivery services,
activity controller, and PR #227's synthetic QA harness. No production data or
provider delivery was used.

## Contract and compatibility

`RecordDestination` extends `LearningDestination` with `{kind, id, context,
anchor}`. IDs may be positive integers or numeric strings; legacy recordings
use `legacy-<cohort>-<one-based-item>`. Lesson block anchors use `block_id`;
message anchors use `message_id`. Both clients accept legacy `messageId`.

Kinds: lesson, module, submission (staff review), help_request (staff support),
follow_up (staff intervention), channel, dm, announcement, recording, meeting,
and cohort. A learner's submission/help notification resolves to its source
lesson/block or recording. Meetings use cohort/booking/week context and a
boolean `staff` presentation hint. Unknown or invalid context entries are
removed independently. Duplicate query keys invalidate only that key.

The shared executable table is
`mobile/src/lib/fixtures/record-destination-contract.json`. Rails, Vitest and
Jest read it and check web/native adapters, including round trips from legacy
web paths. The original `notification-wire-contract.json` continues to pin
installed-build routing against the frozen installed router. Expo tests also
pin the complete legacy DM payload excluding only the additive descriptor.

No stored rows are rewritten. Notification JSON, browser push and Expo push
add `destination` while retaining `path`, `destination_path`, and `message_id`
with their previous meanings. In particular, Expo's legacy exact message path
still contains `messageId`. Emails use the server web adapter for message and
redo links. Recording serialization and help context serialization add the
descriptor alongside existing paths. Activity destinations retain their old
flattened fields for installed clients.

Platform-local adapter implementations avoid importing runtime source outside
`web/` or `mobile/`. Only JSON fixtures cross those roots in tests. Metro/EAS
and Netlify need no package exports, watchFolders, or install/build changes.
The shared table is the parity gate; adding a record kind requires updating
both adapters and the server. Existing role-aware authoring/workspace URLs in
`web/src/lib/routes.ts` remain separate from a server-selected record target.
The browser service worker continues to use the compatible exact path and
message ID emitted with its descriptor, so an already installed worker works.

## Acceptance evidence

Synthetic fixture preflight: harness-created local DB, student 3 and admin 1;
redo lesson 3 / cohort 1 / block 13, channel 4 / message 2, recording 1,
announcement 1; two synthetic activity events. No device runs.

| Journey | 1280×844 | 390×844 | Observable result |
|---|---|---|---|
| Inbox → redo | Passed | Passed | `/lessons/3?cohort_id=1#block-13`; feedback and submission rendered; block focus/scroll verified |
| Inbox → message | Passed | Passed | `/messages/4?message_id=2`; exact synthetic message visible |
| Inbox → recording | Passed | Passed | `/recordings?cohort_id=1&recording=1`; exact recording selected |
| Inbox → announcement | Passed | Passed | `/announcements/1`; exact announcement body |
| School activity → lesson | Passed | Passed | Same block focused, `return_to` retains school activity context |
| School activity → recording | Passed | Passed | Same recording selected, `return_to` retained |

Six scenarios, twelve viewport executions passed. No horizontal overflow in
those destinations. Revisiting the inbox showed zero unread notifications
and no individual Mark read buttons: notification clicks persisted read state.
External placeholder media intentionally did not play. WebKit/Safari and native
device interactions were not run, as requested; provider delivery was simulated
in unit tests. Shared preview tab was closed.

Automated gates: API full suite; RuboCop; Brakeman (zero warnings, one existing
ignored warning); Zeitwerk; both web TypeScript projects; ESLint; Vitest; web
build; bundle check; Netlify routing/service-worker checks; mobile typecheck
and Jest. API: 1,188 tests. Web: 153 suites / 1,556 tests. Mobile: 125 suites /
978 tests. Final contract round-trip tests also ran separately in web/mobile.
Expo export succeeded for iOS and Android. Node 20.19.5 used for web/API;
Expo export used Node 22.22.3 to satisfy mobile's checked-in engine requirement.
Impeccable advisory scan returned `[]` for changed component/hook paths.

Resource cleanup: QA runner stopped only its recorded PIDs 29256/29283 and
dropped its own `csg_qa_29184_1794734932` database. The lifecycle helper failed
before initialization with `Invalid machine profile: schema_version must be 1`;
the runner's exact identity tracking was used instead. Shared PostgreSQL stayed
running. The separate test database `csg_record_destination_test` was dropped after the
final API run (1,188 tests / 8,039 assertions). PostgreSQL catalog and PID checks
confirmed both task databases and both harness server PIDs absent.

## N-2 follow-up inventory for 3.4b

Destination/path pairs are handled here. Remaining logic pairs should move in
small slices with explicit domain acceptance, rather than changing learner
completion or submission behavior during a navigation compatibility change.

| Pair (web / mobile) | Finding and recommended follow-up |
|---|---|
| `web/src/lib/learningStatus.ts` / `mobile/src/lib/learning-status.ts` | Duplicate learner status/review precedence. Emit server-computed block/lesson status in serializers, then retain only presentation labels in clients; first add a shared JSON truth table for redo, awaiting review, closed, and empty video cases. |
| `web/src/components/shared/ContentBlockRenderer.tsx` / `mobile/src/lib/learning.ts` (`submissionTypeFor`) | Both infer missing submission types from exercise/GitHub flags. Serialize an effective submission type from ContentBlock and migrate legacy block payloads with a shared fallback table. |
| `web/src/components/shared/VideoPlayer.tsx` / `mobile/src/lib/video-progress.ts` | Confirmed drift: web caps positive media deltas at max(2, wall delta × rate + .5); mobile rejects deltas above wall delta × max(rate,1) + .75. Choose one crediting policy, extract a pure shared algorithm or generated platform copies with seek/rate/background fixtures, and enforce monotonic bounded credit on the API. Both also promote ended playback to duration; review that policy explicitly. |
| `web/src/lib/videoSegments.ts` / `mobile/src/lib/video-segments.ts` | Segment normalization/seeking duplicated. Server-normalize segment metadata, with a shared edge-case fixture before removing client normalization. |
| `web/src/lib/videoUploadValidation.ts` / `mobile/src/lib/video-upload.ts` | Similar upload constraints with platform-specific file handling. Publish API upload constraints and keep browser/native file access local. |
| `web/src/lib/enrollments.ts` / `mobile/src/lib/enrollments.ts` | Enrollment selection/access helpers. Prefer server capability/selected enrollment fields; add expired/paused/multiple-enrollment fixtures first. |
| `web/src/lib/privateMeetings.ts` / `mobile/src/lib/private-meetings.ts` | Meeting state/time helpers. Return server booking/action availability; preserve local display formatting with timezone fixtures. |
| `web/src/lib/messageFormat.ts`, `plainText.ts` / `mobile/src/lib/message-format.ts`, `plain-text.ts` | Formatting duplication already has some parity coverage. Extend existing fixtures before any shared runtime package; preserve platform rendering boundaries. |
| `web/src/lib/messageNormalization.ts` / `mobile/src/lib/message-normalization.ts` | Message merge/window normalization. Add shared pagination/deletion/reaction fixtures, then extract a platform-neutral package only after Metro/Netlify build proof. |

N-1 API type generation is deferred. Prefer one OpenAPI 3.1 schema and
`openapi-typescript` over a manually maintained shared types package: schema
validation can cover Rails responses and produce both clients' transport types.
Start with RecordDestination and notifications, then activity/help/recordings,
then learning/submissions, and finally messages/admin endpoints. Keep temporary
local aliases so each endpoint can migrate without replacing all ~3,271 lines
at once. CI should validate response examples and fail on generated-code drift.
A shared package can later distribute generated output; it should not become
a second handwritten schema.

## Fix round 1 — PR #247

Merged `origin/main` at `d8aa790` (peek cards) into the existing branch as
`e1974a7`. Scope remains exact record navigation for students and staff;
this round changes no access checks or deployed data.

Verified all eight review findings. Web notification fallback already handled
unknown descriptors; regression coverage now pins that behavior. Mobile push,
inbox and activity fall back to legacy paths when a descriptor cannot be
adapted. Pins replace the canonical message anchor and clear its legacy alias.
Query-form lesson blocks survive all three adapters. Native recording aliases
and updates retain validated cohort context. Student help responses point to
learning context; staff retain support links. Serializers reuse resolved paths,
and invalid recording URLs return null. Shared literal wire descriptors and a
byte-comparison test protect contract expectations and adapter copies.

Regression proof: ran the new tests with the corresponding implementations
from `3442304`, then restored the fixed files. Mobile reported 11 failing cases
across five suites, covering pin selection, unknown-descriptor push/inbox,
query block, recording/update context, array context, fragment strictness and
invalid recording IDs. Rails caught missing query anchors, student support-link
exposure and duplicate help-context resolution. The old Notification method
also rejects the resolved-path argument used by the new reuse regression.

Agent-executed screen tests verify notification → different pin changes the
loaded anchor, and unknown push/inbox descriptors preserve the message ID on
fallback. Native device/provider delivery and Safari were not run on this
headless Mac mini. These are automated interaction results, not device QA.

Final gates: API 1,205 tests / 8,185 assertions passed with
`PARALLEL_WORKERS=1`; the default forked run hit a local pg segmentation fault.
RuboCop passed (527 files), Brakeman reported zero warnings and one existing
ignore, and Zeitwerk passed. The final push-service test also passed after
removing an unnecessary test double (5 tests / 14 assertions).
Web used Node 20.19.5: both TypeScript projects, ESLint, all 155 Vitest suites /
1,594 tests, production build, bundle check, Netlify routing and service-worker
checks passed. Mobile used Node 22.22.3: typecheck, lint (zero errors; 33 existing
warnings), all 125 Jest suites / 1,005 tests, and final iOS/Android Expo export
passed. The routing screen subset passed separately after the fallback cleanup.
Impeccable returned `[]` for the changed mobile component paths.

The lifecycle helper again failed to initialize with
`Invalid machine profile: schema_version must be 1`. Exact task resources were
tracked directly: no application server or browser tab was started; exports
and test processes exited. Dropped `csg_record_destination_round1_test` and
verified no matching databases remain. Shared PostgreSQL and borrowed processes
were left running. Branch/workspace retained for the requested review round;
no merge, deployment or PR watch was performed.
