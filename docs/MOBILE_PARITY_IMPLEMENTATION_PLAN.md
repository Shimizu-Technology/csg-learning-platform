# CSG Connect Mobile Parity Implementation Plan

Owner: Shimizu Technology

Product: CSG Connect

Platforms: iOS and Android through Expo / React Native

Backend: existing Rails `/api/v1` API
Status: active execution plan

## 1. Outcome

CSG Connect will become the everyday mobile interface for Code School of Guam. A student should be able to communicate, understand what needs attention, learn, submit work, review feedback, and watch class recordings without needing a laptop. An instructor should be able to communicate, monitor progress, and perform quick interventions from a phone.

The target is **mobile task parity** with deliberate authenticated web handoffs for desktop-shaped administrative work. Literal duplication of every web screen is not the goal.

## 2. Product principles

1. Rails remains the authorization and data-integrity boundary.
2. Native route guards improve UX but never replace server checks.
3. A failed or queued mutation must never look successfully synchronized.
4. Each surface is designed for touch, keyboard avoidance, dynamic type, safe areas, interruption, and unreliable mobile networks.
5. Shared state such as unread counts, enrollment scope, progress, submissions, and notification preferences must converge across web and native.
6. Dense authoring and bulk operations get an explicit authenticated web handoff until a native workflow demonstrably improves them.
7. Every phase is independently releasable and must pass its release gate before the next phase begins.

## 3. Target information architecture

The final student navigation is:

| Tab | Primary jobs |
| --- | --- |
| Today | Next action, current lesson, due/redo work, important updates, office hours |
| Learn | Modules, lessons, resources, recordings, progress |
| Messages | Workspaces, channels, DMs, rich messaging, search |
| You | Identity, cohorts, GitHub, notification and download preferences |

Staff receive role-aware additions inside Today, Learn, Messages, and You instead of a separate desktop-style admin application.

During Phase 1, the current Messages / Updates / You navigation remains. Updates is folded into Today when Phase 2 ships.

## 4. Shared native architecture

### 4.1 API contracts

- Expand `CsgApi` by product domain instead of issuing ad hoc `fetch` calls in screens.
- Keep request and response types beside the client until an OpenAPI-generated shared contract is adopted.
- Every mutation returns canonical server state and replaces optimistic state by stable ID.
- API errors preserve HTTP status and machine-readable error code.
- GET requests may retry once for token refresh or transient server errors. Mutations do not retry silently.

### 4.2 Server state

Phase 1 may retain focused React state and AsyncStorage for inboxes and drafts. Before Phase 2, adopt a consistent server-state layer with:

- cache keys scoped by signed-in user and role;
- background refresh and invalidation;
- cursor or anchor pagination;
- stale and offline presentation;
- explicit mutation retry and cancellation;
- cache clearing on logout, revoked access, and account change.

### 4.3 Local data

| Data | Offline policy |
| --- | --- |
| Inbox and recent messages | Read-only cached fallback |
| Draft messages | Persist locally per user and conversation |
| Failed messages | Persist until retried or discarded |
| Announcements and notification inbox | Read-only cached fallback |
| Lessons and resources | Versioned read cache in Phase 2 |
| Submissions and grading | Online mutation with explicit failure; no silent queue initially |
| Recording downloads | Managed file catalog in Phase 3 |

AsyncStorage remains appropriate for small preferences and drafts. A versioned local database is required before caching lessons, progress, submissions, and recording metadata.

### 4.4 Deep links

Maintain one allowlisted registry for:

- channel and DM conversations;
- message/thread anchors;
- announcements and notifications;
- lessons and modules;
- recordings;
- submissions and staff alerts.

Unknown, unauthorized, or malformed paths must resolve to a safe native destination without exposing identifiers or crashing.

### 4.5 Observability

Before Phase 2 production release, capture:

- crash and handled-error reports;
- cold start and initial-data timings;
- API latency and failure category without sensitive bodies;
- Action Cable connection and reconnect state;
- push registration and deep-link routing failures;
- upload and playback failures;
- product events for the high-value flows in each phase.

## 5. Phase 1 — Communications parity and production identity

### 5.1 Product identity

Deliverables:

- approved Connected C vector master;
- 1024px opaque iOS fallback;
- iOS light, dark, and tinted variants or an Icon Composer `.icon` package;
- Android adaptive foreground, background, and monochrome assets;
- simplified splash artwork;
- matching small in-app brand mark where appropriate;
- real-device validation at notification, Settings, Spotlight, Home Screen, and App Library sizes.

Acceptance:

- The icon contains no pre-rounded outer mask.
- Critical geometry survives circular and squircle Android masks.
- The mark remains recognizable at 32 and 64 pixels.
- Default, dark, and tinted iOS appearances preserve the same silhouette.
- `expo config`, iOS export, and Android resource generation succeed.

### 5.2 Conversation history and reliability

Deliverables:

- anchor/cursor pagination for older messages;
- stable visible-content anchoring while prepending history;
- reliable latest-message positioning on initial load and keyboard transitions;
- scroll-to-latest control and unseen-message count;
- per-user, per-conversation draft persistence;
- optimistic send state with sending, failed, retry, and discard actions;
- Action Cable reconciliation without duplicates;
- read-state updates only when the user is actually viewing the latest region;
- reconnect indicator and manual refresh fallback.

Acceptance:

- Loading older history does not jump the visible message.
- Opening or closing the keyboard preserves the user's position unless they were following the latest message.
- A failed message remains visibly failed after navigation or relaunch until retried or discarded.
- Realtime echo and REST response reconcile to one canonical message.
- Incoming messages do not pull a reader away from older history.

### 5.3 Attachments

Deliverables:

- photo-library and document selection;
- client-side type and 25 MB size checks matching Rails;
- S3 presign and multipart form upload;
- per-file queued, uploading, failed, and uploaded states;
- cancellation and retry before send;
- attachment-only messages;
- native image preview and system document opening/sharing;
- accessible filename, type, and size presentation;
- cleanup or expiration strategy for presigned-but-unsent uploads.

Acceptance:

- JPEG, PNG, WebP, GIF, PDF, text, and ZIP behavior matches the backend allowlist.
- Unsupported or oversized files fail before upload with actionable copy.
- A network failure cannot send a message referencing an incomplete upload.
- Signed download URLs are treated as short-lived and are not persisted as permanent identifiers.

### 5.4 Message content, mentions, and threads

Deliverables:

- mention autocomplete scoped to authorized conversation members;
- mention IDs sent separately from body text;
- mention highlighting in rendered messages;
- link detection and safe external opening;
- thread/reply entry from a message action;
- focused thread view with root context and reply composer;
- thread reply count on root messages;
- search-result navigation to the anchored message or its thread.

Acceptance:

- Typing `@` produces keyboard-accessible and screen-reader-accessible suggestions.
- Unauthorized IDs cannot be introduced through the client or API.
- Reply events update the correct root without appearing as duplicate top-level messages.
- A deep link to a reply opens the appropriate thread context.

### 5.5 Message actions

Deliverables:

- touch-first long-press action sheet;
- edit own message and staff moderation edit where server-authorized;
- delete confirmation and tombstone reconciliation;
- pin/unpin for staff;
- pinned-message list and jump-to-message;
- curated reaction picker and reaction chips;
- reaction participant details;
- read-receipt participant details;
- copy message text and share permitted attachment links.

The curated reaction control uses consistent vector icons and labels. Existing user-generated reaction data remains displayable and interoperable with web.

Acceptance:

- Action visibility reflects both role and message state.
- Deleted messages cannot be edited, pinned, replied to, or reacted to.
- Server rejection rolls optimistic action state back with clear feedback.
- The pinned view and conversation update through Action Cable without a reload.

### 5.6 Workspace, channel, and member controls

Deliverables for authorized staff:

- create community workspace;
- edit and archive community workspace;
- add and remove community members;
- create channel with visibility and description;
- edit and archive channel;
- view cohort workspace members without pretending cohort membership is editable there;
- role-aware management entry points from the workspace switcher and channel header.

Acceptance:

- Students never see management affordances.
- Cohort membership clearly redirects staff to cohort administration rather than presenting a broken remove action.
- Archived channels/workspaces disappear or become read-only consistently with the web product.
- Member and channel changes invalidate the inbox and workspace caches.

### 5.7 Announcements and notification inbox

Deliverables:

- paginated announcements with detail view and read filters;
- staff announcement studio for cohort, global, and staff audiences;
- publish, pin, push, and archive controls;
- full notification inbox covering announcements, messages, mentions, and DMs;
- individual and mark-all-read actions;
- deep-link navigation from each notification;
- global notification preference and per-conversation mute state;
- device push registration status and recovery guidance.

Acceptance:

- Audience and cohort options are server-scoped and role-aware.
- Read state converges between the notification list, announcement detail, inbox badges, and web.
- A disabled global preference does not silently re-enable during device-token refresh.
- Every notification path passes through the native allowlist.

### 5.8 Phase 1 test matrix

Automated:

- Rails integration tests for any pagination, thread summary, upload cleanup, or serialization additions.
- Mobile unit tests for draft keys, optimistic reconciliation, mention parsing, attachment validation, reaction mapping, notification routing, and message pagination.
- Component tests for message actions, failed-message controls, attachment cards, mention suggestions, and management role visibility.
- TypeScript strict mode, ESLint, Expo Doctor, dependency validation, iOS JS export, and Android JS export.

Device interaction:

- student, instructor, and admin accounts;
- single and multiple workspaces;
- channel, one-to-one DM, and group DM;
- empty, short, and long histories;
- keyboard open/close and interactive dismissal;
- slow/offline network during load, send, reaction, upload, and reconnect;
- attachment-only and mixed text/attachment messages;
- push tap from terminated, backgrounded, and foregrounded states;
- dynamic type, VoiceOver labels, reduced motion, and small-screen layout;
- icon appearances and Android mask previews.

## 6. Phase 2 — Student learning core

Implementation status: complete on `codex/mobile-parity-phase-2`, pending PR review and merge.

### 6.1 Today

- next best action;
- current lesson and learning-path progress;
- due, redo, and recently graded work;
- priority announcement and unread communication summary;
- next office-hours session;
- honest loading, empty, locked, and offline states.

### 6.2 Learn

- module and week navigation;
- unlock and assignment state;
- lesson rendering for text, headings, lists, callouts, code, images, links, and video blocks;
- exercise instructions and submission status;
- submission creation/update and instructor feedback;
- resources with categories and search;
- role- and enrollment-aware deep links.

### 6.3 Interactive coding decision

Initial delivery uses native lesson reading with an authenticated in-app web handoff for interactive browser runtimes. A native editor may follow, but local language runtimes are not accepted into scope until offline execution is validated as a student need.

### 6.4 Phase 2 release gate

- A student can complete every ordinary daily learning action from a phone, except the explicitly handed-off interactive code runner.
- Progress, submission, lock, and redo state match the web app after refresh.

Implemented evidence:

- Today combines next action, server-derived learning progress, current redo state, recently graded passing work, pinned/unread announcements, communication shortcuts, and upcoming office hours.
- Learn provides searchable modules, explicit available/locked states, lesson navigation, rich native Markdown content, safe links, S3/external video opening, and searchable resources.
- Text, repository, repository-plus-live-site, manual-complete, and GitHub-sync assignment states match the Rails submission contract. Ungraded work updates in place; redo work creates a new attempt; passing work is read-only.
- TanStack Query uses Rails-user-scoped keys and a versioned SQLite persistence layer. Learning caches clear on logout and revoked access; mutations remain online-only and never silently queue.
- Interactive runners use a Rails-issued 60-second, one-use Clerk Account Portal link to authenticate the same user into the responsive web lesson. Device JWTs are never placed in URLs.
- Lesson payloads identify the exact server completion-driving blocks, preventing mixed video/exercise lessons from displaying progress that disagrees with the web app.
- Lesson renderer fixtures cover every content-block type present in production data.
- Revoked enrollment closes cached lesson access on the next authorization refresh.
- iPhone 16 Pro / iOS 18.5 Simulator interaction verified Today → Learn → module → lesson → profile in the native development build, including locked-state labels and back navigation.
- Local release gate: Rails 273 tests / 810 assertions, mobile 15 suites / 44 tests, web 5 suites / 21 tests, RuboCop 209 files, Brakeman zero warnings, bundler-audit clean, Expo Doctor 20/20, dependency validation clean, and successful iOS and Android Hermes exports.

## 7. Phase 3 — Native recordings

Deliverables:

- recording library grouped by cohort and date;
- signed stream URL acquisition and renewal;
- native playback for S3 recordings;
- YouTube fallback;
- resume position and periodic watch-progress synchronization;
- playback speed, orientation, interruption, route-change, and audio-session handling;
- picture-in-picture decision and implementation where supported;
- optional managed offline downloads only after expiration, privacy, storage, and logout policies are approved.

Release gate:

- Playback resumes within the accepted tolerance across web and native.
- Background/foreground transitions and phone-call/audio interruptions do not corrupt progress.
- Expired signed URLs recover without losing position.
- Watch-progress staff reports reflect native viewing.

## 8. Phase 4 — Staff intervention tools

Native staff workflows:

- attention queue and student health summary;
- student detail, recent activity, lesson progress, submissions, and recording progress;
- quick grade, redo, and concise feedback actions;
- GitHub sync status and handoff where repository inspection is required;
- cohort announcement, messaging, resource, and recording actions suitable for a phone;
- push alerts for urgent student and submission events.

Deliberate web handoffs:

- curriculum architecture and module scheduling;
- rich lesson/content-block authoring;
- bulk enrollments and team administration;
- dense cohort grading and watch-progress matrices;
- complex access-override configuration.

Release gate:

- An instructor can understand and respond to a student's urgent state without a laptop.
- Every unsupported administration action has a labeled authenticated handoff, not a dead end.
- Student data remains role-scoped and is removed from local caches on logout.

## 9. Cross-phase security checklist

- Clerk token remains in encrypted platform storage.
- Rails authenticates and authorizes every resource.
- Local caches are keyed by Rails user ID and cleared on account change.
- S3 keys are never trusted without destination prefix and metadata validation.
- Signed URLs are treated as temporary secrets and excluded from logs/analytics.
- External links use an allowlisted scheme and user-visible destination.
- Deep links validate route, identifier shape, and server access.
- Push payloads contain only the minimum preview needed for the product.
- Screenshots, logs, analytics, and crash reports exclude tokens, email bodies, and private message bodies.
- Revoked/archived users reach access-denied handling on both web and native.

## 10. Pull request and review gate for every phase

1. Start from updated `main` on a dedicated `codex/` branch.
2. Keep implementation, tests, and documentation in the same phase PR.
3. Run the complete relevant local check suites.
4. Run the app in iOS Simulator and exercise the phase interaction matrix.
5. Validate an Android export even when no Android emulator is available.
6. Push and open a ready-for-review PR with scope, architecture decisions, screenshots, and exact checks.
7. Request Greptile review.
8. Inspect every unresolved thread and the generated summary.
9. Fix legitimate findings, add regression coverage, push, and request re-review.
10. Do not merge until Greptile reports 5/5 with no unresolved actionable findings and required CI checks pass.
11. Merge, switch local checkout to `main`, and pull with fast-forward only.
12. Record the merged PR and verification evidence before beginning the next phase.

## 11. Final TestFlight and App Store Connect gate

After all phases:

1. Run full Rails, web, and mobile regression suites.
2. Perform production-backend smoke tests with student, instructor, and admin accounts.
3. Increment native version/build numbers and update release notes.
4. Confirm privacy nutrition labels, support URL, privacy URL, export-compliance response, age rating, and notification/data disclosures.
5. Capture final screenshots from a release-equivalent build with representative authorized data and no private student information.
6. Produce the required current iPhone and iPad screenshot sizes; include Android store assets if Play submission is in scope.
7. Upload the signed EAS production build.
8. Wait for App Store processing and resolve any compliance prompts.
9. Add the build to the intended internal TestFlight group and verify the user's Apple ID has access.
10. Install from TestFlight on a physical iPhone and test authentication, production API access, push delivery, deep links, media, and critical role flows.

App Store submission for public review remains a distinct final action after TestFlight acceptance. TestFlight distribution does not by itself submit the public App Store version.

## 12. Completion evidence

A phase is complete only when all of the following exist:

- merged source on `main`;
- passing local and CI checks covering the phase;
- simulator or device evidence for the interaction matrix;
- no unresolved actionable review threads;
- a Greptile 5/5 summary on the final reviewed commit;
- updated architecture/product documentation;
- a recorded list of intentionally deferred items with owner and target phase.

The overall mobile-parity program is complete only after every phase gate passes, the final TestFlight build is installable, and the production-backend smoke test succeeds on the physical device.
