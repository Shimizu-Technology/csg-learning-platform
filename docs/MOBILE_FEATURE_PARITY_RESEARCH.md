# CSG Connect: Native Brand and Feature-Parity Research

Status: research complete. The four-phase parity program described here has shipped to `main`; the release and TestFlight evidence is tracked in [`app-store/README.md`](./app-store/README.md).

The execution scope, phase acceptance criteria, review gates, and final TestFlight checklist are defined in [`MOBILE_PARITY_IMPLEMENTATION_PLAN.md`](./MOBILE_PARITY_IMPLEMENTATION_PLAN.md).

## Recommendation

Build toward **task parity**, not literal screen parity.

Students should be able to complete every common, time-sensitive Code School task from a phone. Staff should be able to monitor, communicate, and handle quick interventions. Dense curriculum authoring, cohort configuration, bulk enrollment, and grading matrices should remain web-first, with responsive web handoffs from the app where necessary.

This produces a more useful mobile product sooner and avoids recreating desktop-shaped interfaces on a small screen.

## App icon direction

The current icon places the horizontal CSG wordmark inside a square canvas. At home-screen and notification sizes, the wordmark becomes too small to read and the large empty area weakens recognition.

The recommended **Connected C** mark is in `docs/brand/csg-connect-mark.svg`. It combines:

- an open conversation bubble;
- a subtle `C` for CSG and Connect;
- a tail that makes messaging unambiguous;
- two olive connection points that preserve a link to the existing CSG identity;
- the mobile app's ruby accent and charcoal foundation.

The mark has no embedded text, fine detail, shadows, or pre-rounded outer mask. It is designed to remain identifiable at small sizes and to support default, dark, tinted, and monochrome treatments.

### Production asset set delivered

Phase 1 delivered editable SVG masters plus generated PNG assets for:

- iOS light, dark, and tinted appearances;
- an opaque 1024px fallback without pre-rounded corners;
- Android adaptive foreground and monochrome layers with protected geometry;
- a simplified splash mark and monochrome notification icon.

Expo references each appearance directly in `mobile/app.json`. The editable sources and exact regeneration commands live in `mobile/assets/brand/README.md`; both iOS and Android resource generation pass. Final visual acceptance on physical launchers remains part of the TestFlight/device checklist rather than being inferred from a simulator.

Official guidance:

- [Apple Human Interface Guidelines: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Expo: Splash screen and app icon](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)
- [Android Developers: Adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)

## Baseline at the start of research

At the start of this research, the Rails API already exposed most of the platform domain. The missing work was primarily native product design, API-client coverage, offline behavior, and mobile-specific interaction—not a ground-up backend rewrite. The table below is historical; the implemented outcome is recorded in the phase plan and mobile architecture document.

| Product area | Web | Native today | Parity gap |
| --- | --- | --- | --- |
| Authentication and authorization | Clerk sign-in, role/access gates | Clerk sign-in, access-denied handling | Small: account recovery and session edge-case polish |
| Workspaces, channels, and DMs | Complete | Core flows present | Medium |
| Rich messaging | Attachments, mentions, reactions, edit/delete, pins, read state, preferences | Text send, real-time updates, search, mute, optimistic delivery | Large |
| Announcements and notifications | Feed, detail, push, staff authoring and audience controls | Feed, read state, push/deep links | Medium |
| Student dashboard | Today, notices, progress, upcoming and intervention state | Missing | Large |
| Curriculum and lessons | Module/lesson navigation, rich blocks, exercise submissions | Missing | Large |
| Recordings | Signed playback, YouTube, resume/watch progress | Missing | Large |
| Resources | Categorized/searchable resource library | Missing | Medium |
| Profile and enrollment context | GitHub, cohorts, notification settings | Basic identity and sign-out | Medium |
| Staff operations | Student health, progress, grading, cohort and recording workflows | Missing | Very large |
| Admin authoring | Curriculum, lessons, rich blocks, team management | Missing | Very large |

## What full, useful mobile parity should include

### 1. Finish communications parity first

This should remain the next product milestone because the app is already structurally optimized for it.

- Image and file attachment selection, upload progress, preview, download, and failure recovery.
- Reaction picker and reaction state.
- Edit and delete for the sender, with role-aware moderation actions.
- Pin/unpin and a pinned-message surface.
- Mention autocomplete and safe rich-message rendering.
- Read-receipt detail where the web experience exposes it.
- Thread/reply interaction if threaded conversations remain part of the product direction.
- Older-message pagination, stable scroll anchoring, draft preservation, and explicit resend/cancel for failed optimistic messages.
- Channel/workspace/member administration for authorized staff.
- Announcement creation, audience selection, pinning, and archiving for staff.
- Notification preferences by conversation and event type.

The backend already has endpoints or data shapes for most of these. The largest new native concerns are uploads, rich content, durable local state, and touch-first management UI.

### 2. Add a student-first learning shell

Recommended tab structure after communications is mature:

- **Today** — current lesson, due/redo work, announcements, office hours, and the next best action.
- **Learn** — modules, lessons, resources, and progress.
- **Messages** — current communications product.
- **You** — profile, cohort context, preferences, and downloads.

`Updates` becomes part of Today or a notification inbox rather than consuming a permanent tab by itself.

The first learning release should support:

- dashboard and learning-path summary;
- modules, weeks, lesson state, and unlock rules;
- native rendering for text, headings, lists, callouts, images, links, and video blocks;
- exercise instructions, status, submission, redo state, and instructor feedback;
- resources, office hours, and cohort context;
- deep links from notifications into the exact lesson, announcement, or conversation.

### 3. Treat code execution as a separate architecture decision

The web lesson experience can use browser-oriented editors and runtimes. A native React Native app cannot simply reuse Monaco, Pyodide, or browser WASM assumptions with equal reliability.

Use one of these staged approaches:

1. **Recommended first:** native lesson reading and submission, with an authenticated in-app web handoff for interactive coding exercises.
2. Add a purpose-built native editor for editing and GitHub submission, while execution remains server-side or web-hosted.
3. Only build fully local language runtimes if offline code execution becomes a validated student need; it carries significant binary-size, sandboxing, keyboard, and maintenance cost.

This decision is the main technical fork in true learning parity.

### 4. Build recording playback as a native subsystem

- Signed URL acquisition and refresh.
- Native playback with resume position and periodic watch-progress synchronization.
- YouTube fallback for legacy recordings.
- Background audio, interruption handling, orientation, and picture-in-picture decisions.
- Download/offline playback only after storage limits, expiration, privacy, and logout cleanup are defined.

### 5. Give staff mobile intervention parity

Staff mobile value is in quick decisions, not desktop administration:

- attention queue and student health summary;
- student detail, recent activity, progress, and contact actions;
- submission review, concise feedback, and grade/redo decisions;
- cohort announcement and channel management;
- recording/resource publishing from the device where practical;
- push alerts for blocked students, new submissions, and urgent messages.

Dense grading matrices, bulk enrollment, curriculum scheduling, and rich lesson authoring should open the responsive web admin unless mobile demand proves strong.

## Foundation work before adding major surfaces

1. Expand the typed mobile API client or generate it from a shared contract so web and native cannot silently drift.
2. Introduce a server-state cache with deliberate invalidation, pagination, retry, and background refresh semantics.
3. Replace ad hoc screen caches with a versioned per-user local database if lessons, submissions, recordings, and downloads become native.
4. Define offline behavior per entity: read-only cache, queued write, conflict resolution, or online-required.
5. Establish role- and enrollment-aware route guards in one place.
6. Add crash reporting, performance traces, structured API errors, and product analytics before the surface area multiplies.
7. Add end-to-end tests for student, instructor, admin, multi-cohort, revoked-access, offline, and expired-session scenarios.
8. Define a cross-platform deep-link registry covering messages, announcements, lessons, recordings, submissions, and staff alerts.
9. Add accessibility and dynamic-type testing to the release checklist.

## Recommended sequence and effort

These are planning ranges for one experienced React Native engineer with backend support, not delivery commitments.

| Phase | Outcome | Approximate effort |
| --- | --- | --- |
| 0. Native foundation | Shared contracts, server-state strategy, local data model, observability, expanded navigation | 1–2 weeks |
| 1. Communications complete | Rich messages, attachments, management, announcement authoring, reliability polish | 3–5 weeks |
| 2. Student learning core | Today, Learn, modules, lessons, submissions, resources, profile | 5–8 weeks |
| 3. Recordings | Native playback, resume/progress, legacy sources | 2–4 weeks |
| 4. Staff intervention tools | Attention queue, students, mobile grading, cohort communications | 4–7 weeks |
| 5. Optional admin parity | Native/tablet authoring and bulk administration | 4–7 additional weeks |

A high-value mobile companion can reach student task parity in roughly **11–19 engineer-weeks**. Literal parity including every dense admin and authoring workflow is closer to **4–7 months** for one engineer and would likely produce a worse mobile product than selective web handoffs.

## Definition of done for mobile parity

Parity should be considered achieved when:

- a student can complete every routine daily learning and communication task without switching devices;
- an instructor can receive alerts, understand a student's state, respond, and perform common grading/intervention actions;
- authorization, cohort scope, unread state, progress, and submissions remain consistent across web and native;
- offline and failed-network states never imply that a write succeeded when it did not;
- every unsupported low-frequency admin action has a deliberate authenticated web handoff rather than a dead end;
- accessibility, dynamic type, keyboard behavior, deep links, and push notifications are covered by device-level release tests.

## Product decision needed before implementation

Choose one target:

- **Recommended — mobile task parity:** complete daily student and intervention workflows, with deliberate web handoffs for dense admin work.
- **Literal parity:** recreate every web feature natively, including curriculum authoring and bulk administration.

The first option protects quality, reaches students sooner, and still makes the app a complete everyday product.
