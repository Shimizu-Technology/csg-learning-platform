# CSG Learning Platform — Product Strategy and Learning Experience Plan

**Last reviewed:** 2026-08-01
**Status:** Active product strategy; use this document to choose and sequence new product work
**Scope:** Rails API, React web app, Expo mobile app, Code School of Guam cohort operations, learning design, accessibility, analytics, and platform comparisons

## 1. Executive decision

CSG already has a strong learning operating system. It does not need a generic LMS redesign or literal mobile/web parity. The next product chapter should make the existing system better at producing learning, closing feedback loops, and helping staff intervene at the right moment.

The immediate priority order is:

1. Fix native code-block navigation and complete the mobile readability/accessibility pass.
2. Add reviewed voice-to-text drafts so mobile questions and feedback are easier to capture without sacrificing accuracy or consent.
3. Instrument the learning and support funnels so future decisions use evidence.
4. Give students a clear **This Week** plan and a first-class way to say **I’m stuck**.
5. Turn the existing attention signals into an owned intervention workflow.
6. Add reusable learning objectives, rubrics, and small formative checks.
7. Add captions, transcripts, and searchable chapters to recordings.
8. Build mastery views, GitHub test feedback, recovery plans, and richer cohort analytics on those foundations.

The product should remain deliberately opinionated:

- CSG is a cohort-based coding school, not a university SIS.
- Students need a clear next action, fast feedback, practice, and human support.
- Instructors need a small number of high-signal queues and explicit ownership.
- Mobile owns routine daily work and urgent interventions.
- Web owns authoring, bulk administration, dense comparison, and repository-heavy work.
- Completion and watch time are useful signals, but they are not proof of understanding.

## 2. Evidence reviewed

This plan is based on five evidence streams:

1. The implemented API routes, database schema, web routes, native routes, tests, and design tokens as of commit `8731815`.
2. The rendered public web experience at desktop and 390 px mobile width.
3. Current native App Store screenshot sets and the reported code-block behavior on iOS.
4. Code School’s hybrid operating model: two live evenings, asynchronous practice, Saturday check-ins, Explain → Demo → Exercise, bonus work, deliberate practice, and fast/slow pacing needs.
5. Official documentation from established LMS, coding-learning, cohort-course, accessibility, and learning-science sources listed in section 16.

Relevant internal context includes:

- `docs/PRODUCT_VISION.md`
- `docs/ROADMAP.md`
- `docs/MOBILE_APP.md`
- `docs/MOBILE_FEATURE_PARITY_RESEARCH.md`
- `docs/PRODUCTION_READINESS_AUDIT.md`
- Brain-Dump `code-school/cohort-3-hybrid-format.md`
- Brain-Dump `code-school/cohort3-class-setup-checklist.md`
- Brain-Dump `code-school/actualize-review.md`
- Brain-Dump `code-school/csg-alanna-meeting-agenda.md`

## 3. Current product baseline

### What is already strong

The platform already owns most of CSG’s daily operating loop:

- reusable curricula, modules, lessons, and content blocks;
- scheduled release, cohort pacing, student overrides, and restart safety;
- lesson content, native video, completion, submissions, grading, redos, and GitHub issue feedback;
- cohort management, office hours, resources, recordings, and watch progress;
- announcements, channels, DMs, threads, mentions, reactions, files, search, read state, and push notifications;
- student dashboards and staff attention/student-health views;
- native student learning, submissions, recordings, messaging, and focused staff grading/intervention tasks;
- deliberate authenticated web handoff for desktop-shaped workflows;
- a mature production, security, and release-verification foundation.

The visual direction is also sound. Web feels refined and editorial; mobile feels like a focused, high-contrast native companion. The ruby/slate identity and Manrope typography are memorable enough to refine rather than replace.

### What the domain model measures today

The database can answer:

- what content a student can access;
- what blocks they completed;
- what they watched and for how long;
- what they submitted;
- the latest grade and feedback;
- whether a redo is open;
- when they were last active;
- whether staff or peers communicated with them.

It cannot yet answer directly:

- which skill or learning objective a task assesses;
- what criteria made a submission strong or incomplete;
- whether a student retained or can independently apply a concept;
- which hint or support step helped;
- whether a student is currently stuck and who owns the response;
- what intervention occurred and whether it worked;
- what recovery plan applies after a restart or extended absence;
- attendance and live participation history;
- whether a recording is captioned, transcribed, chaptered, or searchable.

That is the central strategic gap: the product is excellent at organizing learning activity and increasingly strong at communication, but it is not yet a full learning-feedback system.

## 4. What was missed in the first audit

The second pass found additional opportunities:

1. **Intervention ownership is missing.** Risk can be detected, but there is no durable state for owner, outreach, next follow-up, resolution, or outcome.
2. **The curriculum authoring model lacks explicit outcomes and success criteria.** Objectives currently live in lesson prose or instructor knowledge.
3. **Native submission parity is stronger than the roadmap says.** Students can already submit text/repository work, redo, watch video, and mark work complete. Several older mobile documents still describe these as future work.
4. **The web/mobile planning gap is partly an API-shape gap.** Web derives the next submission deadline from module data; native Today does not present it as a weekly plan.
5. **There is no product event taxonomy.** PostHog receives web identity, pageviews, and render exceptions, but no meaningful learning-flow events and no native product analytics.
6. **Current progress percentages can imply more certainty than the data supports.** A completed block or watched recording does not necessarily mean the learner can retrieve or apply the skill.
7. **Recording accessibility is a product gap, not only a compliance task.** Captions and searchable transcripts also make review, catch-up, and finding code explanations substantially better.
8. **The student reset feature needs a pedagogical companion.** The technical reset is safe, but a restart should create a visible recovery plan rather than silently returning a student to week one.
9. **Instructor feedback will become repetitive without reusable criteria and snippets.** The existing concise native grading flow is a good base for a feedback library and rubric-assisted review.
10. **The native design system needs semantic type roles.** One-off small sizes make it difficult to improve readability safely across the app.

## 5. Native code-block overflow: root cause and required fix

### Observed behavior

Fenced code now renders as a real code block in native messages, but long lines can be cut off and the user cannot reliably pan left or right to inspect the remainder.

### What the code currently does

`mobile/src/components/formatted-message.tsx` already places code inside a horizontal React Native `ScrollView`. However, the interaction sits inside a conflicting responder hierarchy:

- the complete message row is a parent `Pressable` with a long-press action in `mobile/src/components/message-bubble.tsx`;
- the code child is a horizontal `ScrollView` inside the conversation’s vertical `FlatList`;
- the code `Text` is `selectable`, giving iOS text selection another gesture claim;
- `nestedScrollEnabled` is present, but React Native documents it as Android-only;
- the outer code block and message bubble both clip overflow;
- the code text does not explicitly opt out of shrinking or prove an intrinsic content width;
- no test verifies horizontal movement or the last characters of a long line.

React Native’s own `ScrollView` documentation notes that contained responders can prevent the scroll view from becoming the responder. Apple also recommends making scrollability apparent because indicators are not always visible. The current combination therefore has two failure modes: the code may not create a larger measurable content width, and a real horizontal pan may be claimed by text selection or the parent message action.

This is a high-confidence code-level root cause. The physical-device fix should still begin with one reproducible long-line fixture so the team can confirm which failure mode is active on the target iOS release.

### Recommended implementation

Create one shared native `MessageCodeBlock` component and make it a clear gesture boundary:

1. Render code with intrinsic horizontal width (`flexShrink: 0`, left alignment, and a content container that is at least the viewport width).
2. Remove `selectable` from the panning surface and add a visible, accessible **Copy** button. Copy is a more reliable mobile code action than fighting text-selection gestures.
3. Keep message long-press actions available outside the code block. If the parent `Pressable` still wins, move long-press handling to a gesture composition that allows the native scroll gesture simultaneously.
4. Use `onLayout` plus `onContentSizeChange` to know when overflow exists.
5. When overflow exists, flash the horizontal indicator once and show a subtle trailing-edge fade or clipped-character cue. Do not display a fake cue when all code fits.
6. Set an appropriate light indicator on the dark code surface and preserve vertical list scrolling.
7. Add an accessibility label such as “Code block, scroll horizontally for more, copy code button available.”
8. Use the same component in thread roots and replies because both render `MessageBubble`.

### Acceptance criteria

- A 160-character unbroken line and a long indented command both scroll fully on iPhone.
- The final character can be brought into view without selecting text or opening message actions.
- Vertical conversation scrolling still works when a gesture begins in the code block.
- Long-press message actions still work when the gesture begins outside the code block.
- Copy copies the exact code without fences or language label.
- Short code does not bounce horizontally or show an overflow affordance.
- Dynamic Type does not hide the Copy control or make the code unreachable.
- VoiceOver identifies the block, its scroll behavior, language when present, and Copy action.
- A Maestro/device test covers the gesture; the existing render-only Jest test remains useful but is not sufficient.

## 6. Mobile experience audit

### P0: readability and accessibility

The native source currently contains 150 `fontSize` declarations at 8–10 pt across 69 style lines. Some are decorative labels, but many carry timestamps, state, supporting instructions, and progress context. Apple’s current guidance recommends 11 pt as the minimum custom text size on iOS and 17 pt as the default, with support for larger text.

The `quiet` token (`#626B7F`) has approximately:

- `3.64:1` contrast on `ink` (`#0B0D12`);
- `3.41:1` on `panel` (`#12151D`);
- `3.19:1` on `panelRaised` (`#181C26`).

That is below the usual `4.5:1` target for normal text. The result is visible in timestamps, labels, metadata, support copy, and inactive navigation.

Required response:

- introduce semantic native roles: `display`, `title`, `section`, `body`, `support`, `label`, `meta`, and `code`;
- set 11 pt as the minimum for meaningful text, reserving 9–10 pt for nonessential decorative eyebrows only;
- replace `quiet` for readable copy with a stronger token while preserving a lower-emphasis decorative token;
- support Dynamic Type instead of scattering fixed sizes;
- allow cards and rows to grow rather than clipping at accessibility sizes;
- manually test largest text, bold text, increased contrast, reduced motion, VoiceOver, and TalkBack;
- keep primary touch targets at least 44 pt.

### P1: reduce card density

The mobile app has good visual consistency, but many screens stack large bordered cards inside other bordered surfaces. Premium mobile products feel focused because the hierarchy is obvious, not because every item has a container.

Refine by:

- using surface changes only for meaningful grouping or elevation;
- replacing low-value cards with rows, dividers, or grouped lists;
- letting one primary action dominate each screen;
- moving tertiary metadata behind progressive disclosure;
- keeping ruby for action/priority and semantic colors for status;
- adding purposeful haptics for send, completion, copy, and successful grading;
- preferring content-preserving skeletons over full-screen loading replacements.

### P1: student weekly orientation

Native Today is good at “continue now” but weaker at “plan the week.” Add a **This Week** section that shows:

- live class and office-hour events;
- required async work grouped by day;
- submission close times;
- open redo work;
- upcoming unlocks;
- recording catch-up;
- optional stretch work clearly separated from required work.

Students who work ahead should be supported. The interface should say what is required, what is open, what is optional, and what will unlock later without punishing early completion.

### P1: reviewed voice-to-text drafts

Add a microphone action to native message composers so students and instructors can speak a short message, receive a conservatively cleaned-up transcript in the editable composer, review it, and then press **Send**. Never auto-send and never treat raw audio as a durable message attachment.

The native implementation now includes a foreground-only recording dependency, explicit microphone permission, and an authenticated server-transcription endpoint. It records only after an intentional tap, shows an unmistakable recording state, keeps background recording disabled, deletes temporary audio, and preserves typing/system dictation as fallbacks. Direct messages and channels are complete behind the documented release gate; threads, contextual help, and concise grading feedback remain later reuse surfaces.

The complete product flow, meaning-preserving formatting contract, privacy rules, architecture, rollout, analytics, and acceptance criteria are in `docs/VOICE_TO_TEXT_PLAN.md`.

### P1: offline continuity

Moodle’s mobile app demonstrates the value of browsing course content offline. CSG should take a smaller, privacy-conscious version of that idea:

- cache lesson text, resource metadata, weekly plan, feedback, and previously loaded message summaries;
- allow offline draft creation for messages and text submissions;
- label every queued write and never imply it succeeded until acknowledged;
- defer media downloads until retention, storage, logout deletion, and signed-URL policy are approved.

## 7. Web experience audit

The public web experience is already premium. The strongest next improvements are inside the authenticated product:

- use one shared student planning model rather than deriving important dates independently per client;
- show learning objectives and success criteria at the start of a lesson and rubric criteria beside submission;
- reduce duplicate progress summaries that communicate the same percentage without a new decision;
- preserve desktop density for grading and cohort matrices, but improve sticky context, keyboard navigation, and saved filters;
- give instructors a clear queue state: new, contacted, waiting on student, follow-up due, resolved;
- expose the student’s recent feedback, help requests, and recovery plan beside their progress;
- add transcript search that jumps directly to a recording timestamp;
- keep content authoring web-first and add reusable templates rather than building a native editor.

The public homepage should remain focused. It does not need a generic feature grid expansion; it can eventually add one authentic cohort outcome or student story once CSG has permission and reliable evidence.

## 8. Intentional mobile/web parity

Parity means completing the job, not duplicating every screen.

| Job | Native | Web | Decision |
| --- | --- | --- | --- |
| See today/this week | Primary | Full | Build shared weekly-plan data; both first class |
| Read lessons and watch recordings | Primary | Full | Maintain parity; add captions/transcripts |
| Submit routine work and redo | Primary | Full | Maintain parity; web for repository-heavy inspection |
| Ask for help and message | Primary | Full | Native-optimized and contextual; reviewed voice-to-text draft on native first, then web only if usage validates it |
| Receive and act on feedback | Primary | Full | Rubric summary native; full history web |
| Grade a focused submission | Primary for common cases | Full | Native concise; web for comparisons/bulk |
| Student intervention | Primary for urgent action | Full | Native acknowledge/message; web full case history |
| Curriculum authoring | Secure handoff | Primary | Keep web-only |
| Cohort/enrollment bulk management | Secure handoff | Primary | Keep web-only |
| Dense grading/watch matrices | Summary/handoff | Primary | Keep web-only |
| Analytics | Glanceable alerts | Primary | Mobile exceptions; web exploration |
| Payments | Status/receipt | Primary admin | Add only when operationally prioritized |

## 9. What to learn from other platforms

| Platform | What it does well | What CSG should borrow | What CSG should avoid |
| --- | --- | --- | --- |
| Canvas | Outcomes, rubrics, mastery calculations, peer review, analytics, calendars | Objective-to-evidence model, reusable rubrics, mastery view | Enterprise navigation and a generic gradebook-first experience |
| Moodle | Learning plans, competencies, quizzes, grades, mobile offline access | Offline lesson continuity and explicit learning plans | Plugin sprawl and configuration complexity |
| Google Classroom | Practice sets with immediate feedback, hints, show-your-work, rubrics, class insights | Small formative checks, contextual hints, criteria visible before submission | Recreating Drive/SIS integrations or guardian features for adult cohorts without demand |
| GitHub Classroom | Tests run on every push and students see results immediately | Import GitHub Actions/test status as feedback evidence | Replacing GitHub or hiding real developer workflow behind a toy runner |
| Brightspace | Release conditions and Intelligent Agents that detect and act on risk | Explainable intervention rules, reminders, owner/history, practice mode | Opaque automation that messages students without staff visibility |
| Khan Academy | Skill-level mastery, unit/course goals, challenge-based evidence, recommended review | Mastery by skill and retrieval-based review | Points as the learning goal or mastery inflation from easy activity |
| Coursera | Deadlines/calendar, labs, peer review, resubmission | Calendar export, structured lab links, optional peer critique | MOOC-scale anonymity and generic peer grading for beginners |
| Codecademy | Clear skill/career paths with lessons, quizzes, projects, and milestones | Milestone language and mixed lesson/practice/project rhythm | Treating the mobile app as only a streak/practice accessory |
| DataCamp | Guided projects and browser-based practice | Structured projects that gradually remove scaffolding | XP as a substitute for durable, independent performance |
| Maven | Cohort home, live events, projects, community, automated coursework/reflection nudges | One cohort rhythm connecting live sessions, async work, and reflection | Marketing/course-commerce scope that does not improve classroom outcomes |
| Circle | Courses beside community, events, office hours, scheduled cohorts | Keep learning and communication adjacent | Leaderboards and broad community gamification unless a real CSG need appears |

The market lesson is not “build every LMS feature.” It is that strong learning platforms combine a clear path, repeated evidence, fast feedback, community, and timely intervention. CSG already has the path and community; evidence and intervention are the next leverage points.

## 10. Product principles for the next phase

### 10.1 Optimize for learning, not activity

Watch time, clicks, completion, and streaks are diagnostics. Promote a skill only when there is evidence that the student can retrieve or apply it.

### 10.2 Make the next useful action obvious

Every student surface should answer: What should I do now? What is due next? What feedback needs action? Where can I get help?

### 10.3 Close loops visibly

Submission → feedback → redo → resolution and help request → response → resolution should have clear state and history.

### 10.4 Keep humans in intervention decisions

Rules should surface candidates and explain why. Staff should own contact, notes, follow-up, and resolution. Do not send sensitive or discouraging automated messages based on a single proxy.

### 10.5 Use AI as assistance, not authority

Good future uses include transcript drafting, feedback-draft assistance, rubric suggestion, question variation, and weekly summaries. Staff approve consequential feedback and students must still do the thinking.

### 10.6 Design for restart, acceleration, and interruption

Students may fall behind, pause, restart, or finish early. The platform should support all four as normal learning states.

### 10.7 Accessibility is part of learning quality

Readable type, captions, keyboard access, simple gestures, and clear language directly affect who can learn and how well.

### 10.8 Measure to improve the program, not surveil students

Collect events tied to explicit product and teaching decisions. Avoid keystroke monitoring, hidden scoring, or opaque “engagement” labels.

## 11. Recommended feature set

### Now: quality and measurement

1. Native code-block horizontal navigation and Copy.
2. Native semantic type/contrast system and Dynamic Type QA.
3. Native reviewed voice-to-text message drafts with temporary audio and explicit Send.
4. Web and native learning-event instrumentation.
5. Shared weekly-plan API and native/web **This Week** presentation.
6. Contextual **I’m stuck** requests from lessons, exercises, and recordings.
7. Intervention case state layered onto the existing attention queue.

### Next: learning and feedback loops

1. Learning objectives and success criteria.
2. Reusable rubrics with criterion-level feedback.
3. Feedback snippet library with instructor personalization.
4. Low-stakes retrieval checks and confidence prompts.
5. Recording captions, transcripts, chapters, and search.
6. Restart/recovery plans and scheduled check-ins.
7. Calendar export for class, office hours, deadlines, and check-ins.

### Later: learning intelligence

1. Student and cohort mastery views by objective.
2. GitHub Actions/autograding status and test feedback.
3. Spaced review recommendations based on objective evidence.
4. Attendance and live-session participation.
5. Capstone milestones, portfolio artifacts, and demo readiness.
6. Optional structured peer review after rubric and psychological-safety rules exist.
7. Curriculum effectiveness views showing where many students struggle or need redos.

### Not now

- a full SIS or transcript-gradebook system;
- LTI, SCORM, or enterprise LMS interoperability;
- a Zoom clone or custom media transport;
- native curriculum authoring or bulk administration;
- a generic AI tutor that gives answers before retrieval and feedback foundations exist;
- persistent voice messages, live voice rooms, background recording, or automatic sending of transcribed drafts;
- points, streaks, badges, or leaderboards as primary motivation;
- plagiarism surveillance as a priority for a small, relationship-driven coding cohort;
- guardian dashboards unless the program model changes or an explicit need emerges.

## 12. Proposed domain additions

These are conceptual models, not migration specifications.

### Learning evidence

- `LearningObjective`: durable skill statement, scope, order, active status.
- `ObjectiveAlignment`: joins objectives to lessons, content blocks, rubric criteria, or assessments.
- `Rubric` and `RubricCriterion`: reusable criteria, levels, descriptions, and optional points.
- `SubmissionCriterionResult`: selected level, comment, grader, and timestamp.
- `KnowledgeCheck`, `Question`, and `Attempt`: low-stakes formative assessment and response evidence.
- `ObjectiveEvidence`: normalized evidence from rubric results, checks, projects, and later automated tests.

### Support and recovery

- `HelpRequest`: student, context, category, urgency, status, owner, timestamps.
- `Intervention`: trigger, evidence snapshot, owner, action, next follow-up, outcome, resolution.
- `RecoveryPlan`: enrollment/restart, target pace, required/optional scope, check-ins, status.
- `AttendanceRecord`: session, student, status, arrival/departure, notes.

### Media and planning

- `RecordingTrack`: caption/transcript file, language, status, source, reviewed timestamp.
- `RecordingChapter`: title, start time, optional objective alignment.
- `CalendarItem` or a shared serialized schedule projection: class sessions, office hours, deadlines, check-ins, and unlocks.

Begin with objectives, rubrics, help requests, and interventions. Do not create every model in one migration series.

## 13. Measurement plan

### Baseline before Phase 1 instrumentation

Before this phase, the web app disabled autocapture and only explicitly sent pageviews, user identity, and render exceptions; native had no product analytics integration. No trustworthy baseline existed for task completion, feedback turnaround, support response, or intervention outcomes.

Implementation update (2026-08-01): the shared Phase 1 event contract, privacy guards, native SDK foundation, and initial web/native learning events are implemented. Production reconciliation and the necessarily time-gated four-teaching-week baseline follow the process in `docs/ANALYTICS_EVENT_CONTRACT.md`.

### Primary KPIs

Use three primary KPIs once instrumentation is stable:

1. **Weekly learning momentum**
   Students who complete the week’s required plan or have an approved recovery plan by the weekly cutoff ÷ active students expected to participate.

2. **Feedback-loop closure**
   Required submissions that reach pass/resolution within the expected service window ÷ required submissions started. Track median time from submission to first meaningful feedback and from redo request to resolved resubmission as drivers.

3. **Demonstrated objective mastery**
   Active objective assignments with sufficient recent evidence at or above the agreed level ÷ objective assignments due to date. Introduce only after objectives and evidence rules exist.

### Driver metrics

- weekly plan viewed and first required action started;
- required work completed on time;
- open redo age;
- help-request acknowledgment and resolution time;
- intervention follow-up completed by due date;
- recording start, meaningful watch, caption use, and transcript-to-timestamp jumps;
- formative-check retry and eventual correctness;
- rubric criteria most often marked below expectation;
- GitHub test pass progression when available.

### Guardrails

- student-reported clarity and workload;
- instructor grading/support time per active student;
- false-positive intervention rate;
- notification opt-out/mute rate;
- accessibility defects and task failure at large text sizes;
- API/error-free session rate;
- no decline in project quality while completion rises.

### Initial event taxonomy

Use privacy-safe IDs and categorical properties; never capture message bodies, submission text, code, signed URLs, or private feedback.

| Event | Key properties |
| --- | --- |
| `weekly_plan_viewed` | cohort, week, role, required_count |
| `learning_step_started` | cohort, module, lesson, block_type |
| `learning_step_completed` | cohort, module, lesson, block_type, source |
| `submission_created` | cohort, block, submission_type, attempt |
| `feedback_viewed` | cohort, submission, grade_state, age_bucket |
| `redo_submitted` | cohort, submission, attempt, age_bucket |
| `help_requested` | cohort, context_type, category, urgency |
| `help_request_resolved` | cohort, category, resolution_bucket |
| `intervention_opened` | cohort, trigger_type, severity |
| `intervention_resolved` | cohort, trigger_type, outcome, age_bucket |
| `knowledge_check_completed` | cohort, objective, attempt, result_bucket |
| `recording_engaged` | cohort, recording, progress_bucket, captions_on |
| `code_block_scrolled` | surface, overflow_bucket |
| `code_block_copied` | surface, language |
| `voice_draft_started` | surface, platform, permission_state |
| `voice_draft_recorded` | surface, duration_bucket |
| `voice_draft_transcribed` | surface, latency_bucket, outcome |
| `voice_draft_inserted` | surface, raw_or_cleaned |
| `voice_draft_restored` | surface |
| `voice_draft_sent` | surface, edit_distance_bucket |
| `voice_draft_discarded` | surface, stage |

`docs/VOICE_TO_TEXT_PLAN.md` is the canonical voice-event contract. Any future change to these events or properties must update both documents in the same pull request.

### Target-setting method

Do not invent percentage targets before a baseline exists.

1. Instrument and validate events for four teaching weeks.
2. Review weekly with Leon and the active instructor; compare event counts to actual students and submissions.
3. Establish baseline distributions by cohort and required/optional work.
4. Set one-quarter targets that improve the baseline without increasing instructor workload or student confusion.

Candidate operating service levels can be tested immediately:

- acknowledge a help request by the next class day;
- provide first meaningful submission feedback within two class days;
- never leave an urgent intervention without an owner;
- follow up on a restart/recovery plan at least weekly.

These are service-level proposals, not measured product targets yet.

## 14. Execution plan

### Phase 0 — Interaction and readability gate (1–2 weeks)

Implementation status: complete in the product code. Final physical-device smoke testing remains part of the TestFlight release checklist.

- reproduce and fix code-block horizontal navigation;
- add Copy and overflow affordance;
- create semantic native type tokens and strengthen readable muted text;
- convert the highest-impact 8–10 pt instructional/status text;
- add Dynamic Type and physical-device acceptance cases;
- correct stale mobile-parity documentation.

Exit gate: long code is fully reachable; common native tasks remain usable at large text; no meaningful normal text fails contrast.

### Phase 1 — Voice, plan, help, and measurement (4–7 weeks)

- complete the voice-provider/privacy spike and ship native record → transcribe → review → send in direct messages and channels;
- define the weekly-plan API projection;
- ship **This Week** on web and native;
- add help requests with lesson/exercise/recording context;
- instrument web and native learning/support events;
- build the first staff support queue using existing attention signals plus help requests;
- establish the four-week baseline review.

Measurement implementation status: event contract and initial capture points complete; the 28-day baseline window starts with the first production release containing the instrumentation.

Exit gate: every active student can see required work and ask for contextual help; every request has visible state; voice drafts never auto-send or retain audio; event data reconciles with source records.

### Phase 2 — Feedback quality (4–7 weeks)

- reuse the reviewed voice-draft flow in threads, contextual help, and concise grading feedback after native message quality is validated;
- add objectives and align them to lessons/blocks;
- add reusable rubrics and criterion feedback;
- add feedback snippets without removing instructor editing;
- create small retrieval checks for selected foundational lessons;
- show students success criteria before work and criterion feedback afterward.

Exit gate: at least one module can show objective → task → rubric/check evidence → student feedback end to end.

### Phase 3 — Recovery and accessible media (4–7 weeks)

- create intervention ownership, follow-up, and outcomes;
- create restart/recovery plans with weekly pace and check-ins;
- add captions and transcript ingest/review state;
- add chapters and transcript search-to-time;
- add calendar export.

Exit gate: a restarted or at-risk student has one visible plan and owner; new required recordings are captioned before release or explicitly marked pending with an approved exception.

### Phase 4 — Mastery and automation (6–10 weeks)

- define objective-evidence rules with instructors;
- build student and cohort mastery views;
- import GitHub Actions/test status;
- recommend targeted review without auto-locking progress;
- add curriculum-level struggle/redo analysis;
- evaluate attendance and capstone milestones.

Exit gate: mastery claims are explainable from visible evidence, and automation never overrides instructor judgment without review.

## 15. Decision and release gates

Every proposed feature should answer:

1. What student or instructor decision becomes easier?
2. What evidence says the problem is real?
3. Is this routine enough for native, dense enough for web, or shared?
4. What is the minimum domain model that keeps state durable and auditable?
5. What event proves adoption or value without collecting sensitive content?
6. What accessibility modes and offline/failure states must work?
7. What existing tool should remain external?
8. What will CSG stop doing manually if this succeeds?

Release acceptance for learning features includes:

- student, instructor, and admin authorization coverage;
- web keyboard/zoom/axe coverage where applicable;
- native large-text, VoiceOver/TalkBack, and touch-target checks;
- offline/retry semantics for queued writes;
- analytics payload privacy review;
- source-of-truth reconciliation for new metrics;
- documentation and operator runbook updates.

## 16. External research sources

All links below were reviewed on 2026-08-01. Product capabilities can change; re-check official documentation before implementation.

### Learning platforms

- [Canvas overview: outcomes, rubrics, peer review, analytics, calendars, and Mastery Paths](https://community.instructure.com/en/kb/articles/662716-what-is-canvas)
- [Canvas Outcomes and mastery calculations](https://community.instructure.com/en/kb/articles/662762-what-are-outcomes)
- [Moodle mobile app: offline content, learning plans, quizzes, grades, and files](https://docs.moodle.org/502/en/Mobile_app)
- [Google Classroom grading, practice sets, personalized feedback, and class insights](https://support.google.com/edu/classroom/answer/16643267?hl=en)
- [Google Classroom student rubrics](https://support.google.com/edu/classroom/answer/9335967?co=GENIE.Platform%3DDesktop&hl=en)
- [GitHub Classroom autograding](https://docs.github.com/en/education/manage-coursework-with-github-classroom/teach-with-github-classroom/use-autograding)
- [Brightspace release conditions](https://community.d2l.com/brightspace/kb/articles/5044-about-release-conditions)
- [Brightspace Intelligent Agents](https://community.d2l.com/brightspace/kb/articles/5305-about-intelligent-agents)
- [Khan Academy Course and Unit Mastery](https://support.khanacademy.org/hc/en-us/articles/115002552631-What-are-Course-and-Unit-Mastery-)
- [Khan Academy teacher reporting](https://support.khanacademy.org/hc/en-us/articles/360031129891-What-reporting-options-are-available-on-Khan-Academy-for-teachers-to-track-student-performance)
- [Coursera grades, deadlines, peer review, programming assignments, and Labs](https://www.coursera.support/s/learner-help-center-quizzes-assignments?language=en_US)
- [Codecademy learning paths and milestones](https://help.codecademy.com/hc/en-us/articles/220453248-Picking-Your-Learning-Path)
- [DataCamp guided coding projects](https://support.datacamp.com/hc/en-us/articles/360006091334-DataCamp-Projects-An-Overview)
- [Maven cohort community](https://help.maven.com/en/articles/6289166-community-overview)
- [Circle courses, community, events, office hours, and scheduled cohorts](https://circle.so/platform/courses)

### Learning design and accessibility

- [Dunlosky et al.: effective learning techniques, including practice testing and distributed practice](https://scholars.duke.edu/publication/954654)
- [Karpicke and Roediger: the role of retrieval in durable learning](https://doi.org/10.1126/science.1152408)
- [Oxford review of formative-assessment strategies and learning](https://ora.ox.ac.uk/objects/uuid%3Ad5e48c75-223a-4fb8-a565-408cfeab8ad4)
- [CAST Universal Design for Learning Guidelines](https://udlguidelines.cast.org/)
- [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
- [Apple scroll-view guidance](https://developer.apple.com/design/human-interface-guidelines/scroll-views)
- [React Native ScrollView reference](https://reactnative.dev/docs/scrollview)
- [Expo Audio recording and microphone-permission reference](https://docs.expo.dev/versions/latest/sdk/audio/)
- [Apple speech-recognition permission guidance](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)
- [OpenAI Audio API transcription reference](https://platform.openai.com/docs/api-reference/audio/createTranscription)
- [W3C prerecorded caption requirements](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded)
- [W3C transcript guidance](https://www.w3.org/WAI/media/av/transcripts/)
- [W3C reflow guidance](https://www.w3.org/WAI/WCAG21/Understanding/reflow)

## 17. Bottom line

CSG’s differentiator should not be “we built another LMS.” It should be:

> One focused place where a coding student always knows what to do next, can get unstuck quickly, receives clear evidence-based feedback, and can see real progress toward independent skill—while instructors can intervene early without managing five disconnected tools.

The next build should start at Phase 0, then instrument Phase 1 before setting numeric outcome targets.
