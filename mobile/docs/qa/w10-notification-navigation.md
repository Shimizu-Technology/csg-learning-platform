# W10 PR 10.1: notification navigation

Scope: Expo mobile, L-4.1–L-4.3. Base: `origin/main` at `3b1f8c65`, 2026-11-16. Public-repository fixtures only.

CSG Learn serves students, instructors and admins. A notification should open the exact record, cohort and anchor under the #247 RecordDestination contract. Clerk sign-in, server session access and community-policy acceptance must finish before entering that record. API permissions remain authoritative; a denied record displays No access.

Sources: `src/lib/fixtures/record-destination-contract.json`, `src/lib/record-destination.ts`, `src/lib/notification-path.ts`, root/app/auth layouts and session provider. Terms follow the glossary in `docs/design/2026-11-platform-redesign/README.md` (#256). SDK 57's installed `expo-router/build/getRoutesCore.js` accepts `unstable_settings.initialRouteName` and its `anchor` alias.

Acceptance and evidence:

- Observer tests cover every contract fixture through warm-tab, warm-detail, background-listener and cold-last-response entry. They assert target parameters, tabs underneath details, deduplication and clearing only after the router acknowledges arrival.
- Expo Router integration tests render real stack/tab navigators, open each fixture and exercise Back to the tab bar. They cover tab route identity preservation: remounting tabs during reset can emit focus and pop the new detail on SDK 57.
- Observer tests hold taps while signed out, restore a descriptor after remount, wait for session/policy readiness, retain denied-session taps and drop expired descriptors, including a matching OS last response. Stored data contains a descriptor plus response ID and expiry, without notification content or credentials.
- BackButton tests cover history, parent and Today fallbacks, 44pt minimum targets and editor guards. Screen tests cover Back in loading/unavailable/error states for cohort, module, student, submission, help request and follow-up plan. Destination tests cover No access on a denied record.
- `mobile/.maestro/ios-student.yaml` adds a warm notification-like link followed by Back. `notification-back.yaml` covers a stopped-app deep link and Back to the tab bar.

Automated result on the PR source tree (Node 22.23.5): `npm run check` passed, including 131 Jest suites / 1,274 tests. A final typecheck and lint after unused-import cleanup passed (34 lint warnings, no errors). iOS and Android production JavaScript exports passed with `--max-workers 2`; iOS was repeated after the final changes. Impeccable's advisory scan of the shared BackButton returned no findings. Web/API were not touched or tested.

Device acceptance is **not run**. This Mac mini cannot run a simulator. The Maestro checks use synthetic/demo fixtures and must run on the next device build. Actual warm/background/cold OS push taps, native gestures and VoiceOver/TalkBack remain device checks; listener mocks and JavaScript exports do not establish those results.

Release: the changes ship in the next TestFlight build. Installed builds are unaffected. No build was submitted by this task.

Resources: no dev server, browser tab, simulator or database was started. Exports and test processes are task-owned and must exit before handback. The installed lifecycle helper could not initialize: `Invalid machine profile: schema_version must be 1`; unrelated services were left unchanged.

## Fix round 1

Review baseline: `7588e0c6`, 2026-11-16. The separate clone was clean; the requested fetch, checkout, fast-forward pull and merge of `origin/main` required no additional changes.

The real NotificationObserver now subscribes to navigation state events, so app/auth redirects and navigator mounting trigger a retry without an unrelated render. Real `renderRouter` tests reproduce the app sign-in redirect, auth return redirect, loading gate and policy gate. All four new router tests failed with the baseline observer restored; the three gate cases stayed at `/`, and the cross-account case retained the held entry. Fixed tests assert the destination, disk removal, OS last-response clearing and no replay after remount.

Held entries include the prior signed-in user ID. Another account, or an unknown prior account, cannot consume them. Explicit SessionProvider sign-out invalidates pending reads, clears the observer's memory, removes held/last-user storage and clears the OS response. Storage operations share one queue so a pending save cannot race the sign-out removal.

Wire destinations are validated and normalized before persistence. Entries also retain the canonical native path, revalidated on restore. Tests cover all contract descriptors, announcement queries, both legacy recording IDs, staff students, every simple path, and an unsafe restored path. Arrival requires route identity and record ID, allowing screens to consume query anchors. Lesson/module notification stacks return to Learn; conversation stacks return to Messages. Back uses a plain label when following history, including non-tab parents. Router tests assert the actual returned pathname.

Maestro's default flow list includes `notification-back.yaml`. Its stopped-app flow opens `CSG_DEVELOPMENT_URL` before the content link and asserts the Today screen heading after Back. These Maestro flows test deep links, **not notification taps**. The real observer is covered by the renderRouter tests. Maestro, native OS push taps, gestures and accessibility on a device remain **not run** on this headless Mac mini.

Resources: the lifecycle helper again rejected the machine profile (`Invalid machine profile: schema_version must be 1`). No server, browser, simulator or database was started; only bounded test/export commands ran. Shared services were left unchanged. The branch and clone remain available for the next review; no merge or PR watch was requested.

Final source validation (Node 22.23.5): `npm run check` passed, including brand/URI checks, TypeScript, ESLint (38 warnings, no errors), and 133 Jest suites / 1,314 tests. The iOS production JavaScript export passed with `npx expo export --platform ios --max-workers 2`. BackButton's Impeccable advisory scan returned `[]`. The Maestro shell script passed `bash -n`. The full suite required completing older router mocks with `canGoBack`; final results include those changes. Test/export processes exited, and the temporary export was removed.
