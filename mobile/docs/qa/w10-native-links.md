# W10 PR 10.2: native links and grading navigation

Scope: L-4.4–L-4.8 and both #265 P3 follow-ups, 2026-11-16. Base: `origin/main` at `e7927777`; implementation tested through `51d90034`. Expo mobile plus the explicitly permitted additive Expo push recipient field. `search.tsx` is unchanged.

CSG Learn serves students, instructors and admins. Students need to follow course links without leaving the app; staff need connected records and a grading queue that preserves their place and feedback. Sources: `docs/PRODUCT_VISION.md`, #247's record-destination contract, #265's observer/router tests, the existing grading list and `DirectConversationsController#available_users` / `#create`. Server access checks remain authoritative.

Agent-executed automated acceptance uses synthetic fixtures:

- Content links: relative and configured school-origin record links map through the existing destination adapter and native allowlist. External web links use the browser sheet. Tests reject unsafe native targets and preserve lesson blocks, cohorts and message anchors.
- Mentions: tapping a named mention opens the author sheet; Message uses the server's authorized recipient lookup and creates or reuses the exact DM. Denied recipients have no Message action. Staff can still choose student-health enrollment context.
- Records: lesson to module, follow-up to help request, student-health cohort and lesson rows, redo/open-help records, submission to lesson, exact cohort announcement, Today to instructor DM, help learning context and cohort schedule have native links. The supplied L-4.6 list is the acceptance scope; no fuller backlog line was present in repository docs.
- Tabs: real `renderRouter` tests open cohort home from Today and exercise Continue learning, Class messages and Updates. Each removes cohort detail and retains exactly one tab navigator.
- Grading: the authorized filtered list becomes a user-scoped, nonpersisted queue snapshot. Router tests cover position, Previous/Next, direct entry without a queue, and unsaved feedback blocking replacement until Leave review is selected. The same removal guard protects Back and other exits. Queue navigation does not bypass record authorization.
- Push: first-update cold taps bind to the captured signed-in Clerk subject while session loading finishes; mismatched subjects are dropped. Sign-out dismisses delivered notifications. New payloads add `recipient_user_id`; another account's tap is rejected. Legacy payload keys remain unchanged and old builds ignore the addition.

Node 22.23.5: mobile typecheck and lint passed (73 warnings, no errors); 135 Jest suites / 1,352 tests passed. Both iOS and Android production exports passed. Focused link tests also passed after preserving raw absolute URLs at the validation boundary. API Expo push service: 16 tests / 73 assertions passed; changed Ruby files passed RuboCop. Impeccable's advisory scan of the content, author and grading components returned no findings.

Native device acceptance is **not run**: this host has no iOS/Android simulator. Actual OS tray cleanup, cold/background notification taps, browser-sheet presentation, native gestures and VoiceOver/TalkBack need the next device build. No TestFlight build was submitted. Installed builds are unaffected by the mobile changes; the API payload addition is backward-compatible.

Resources: no server, browser tab or device runtime was started. Test/export processes exited. The local branch database `csg_mobile_native_links_test` was dropped; the existing Postgres service was borrowed and left running. Lifecycle initialization failed with `Invalid machine profile: schema_version must be 1`; no shared services were changed. Branch and checkout remain for review. Do not merge or watch under this task's instructions.
