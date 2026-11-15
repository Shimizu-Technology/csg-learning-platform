# Glossary and plain-language copy — November 16, 2026

W3 PR 3.8: backlog S-4, U-6.6, T-9, U-4.6, U-2.5 and S-19, plus the CohortHomePanel duplicate-key fix. Base: main `ba529b8` (#251). Branch: `feat/glossary`.

Sources: `docs/design/2026-11-platform-redesign/README.md` §2 (glossary and writing rules), §3 (navigation) and §12 (decisions), the mockups approved in #219, and the seven-item staff sidebar from #246. Brain Dump isn't on this host; the task brief and synced guidance were used instead. Synthetic data only.

## What changed

- **One glossary.** `fixtures/glossary.json` lists every retired name with the term to use. Both naming tests read it: `web/src/styles/naming.test.ts` and `mobile/src/lib/__tests__/naming.test.ts`. `web/src/lib/glossary.ts` holds the terms used in code (`TERMS`, `gradeLabel`, `humanize`, `pageTitle`).
- **The naming tests scan what people read**, using a TypeScript-AST scanner (`web/src/test/uiTextScan.ts`, `mobile/src/test-utils/ui-text-scan.ts`). They read JSX text, copy-like props and attributes, toasts, label functions, label maps and any string literal with a space. They fail on retired names, Title Case labels (U-6.6), raw enum text (`replaceAll('_', ' ')`) and stale exceptions. It's a heuristic: a pass means no known offenders, not proof.
- **UI copy only.** API routes, models, columns, payload keys, analytics event names, URL params, storage keys and notification channel ids are unchanged. For example, `/admin/interventions/:id` is a follow-up plan in the UI, and `/materials` is Learn.
- **Page titles** come from one route table (`web/src/lib/pageTitles.ts`) and read "<Page> · CSG Learn" (product name from brand config). The landing page is "CSG Learn · Code School of Guam". The lesson editor is "Edit lesson" (it showed "Today"); a cohort is "Cohort" (it was "Cohort workspace").
- **Sign-in (S-19).** "Welcome back" appears once: the page keeps it, and the Clerk card subtitle is now "Enter your email to continue." While the sign-in code loads, `/sign-in` and `/sign-up` show the public page with a sign-in card placeholder, not the app skeleton.
- **Brand config.** The two "Code School staff will review it." toasts use `brand.schoolShortName`, and "Built by" uses `brand.operatorName`. The brand-literal test no longer exempts Messages.
- **CohortHomePanel.** Repeating office hours share an id, so each occurrence is keyed by id and start time. A test renders two occurrences and fails on React's duplicate-key warning; it failed before the fix.
- **Learner progress counts lessons, never blocks (U-5.6).** Today and Learn show "3 of 6 lessons". The module line counts the whole module, whatever the filter shows.
- **Mobile** display strings follow the same glossary, and the Maestro flows assert the new copy.

## Terms for Leon to confirm

These terms aren't settled by the README; the README settles everything else in this PR.

| Concept | Chosen | Rejected | Where |
| --- | --- | --- | --- |
| Pace-and-scope plan inside a follow-up plan, for a learner coming back after time away (API `recovery_plan`) | **Return plan** | Recovery plan; Catch-up plan (README Decision 4 uses that for the student-facing agreed plan); Re-entry plan | Follow-up plan page, Support, student page, mobile |
| Scheduled check on a return plan or personal plan (API `check_in`) | **Follow-up**: "Next follow-up", "Add follow-up note", "Follow-ups due" | Check-in (retired); Review (collides with grading) | Same, plus the learner's personal plan |
| How long a self-paced learner can ask an instructor for help | **Help period**: "Help period (weeks)", "You can ask for help until Dec 1" | Instructor support window; Question window | Learn, Today, course settings, mobile |
| Messaging workspace (cohort or community) | **Cohort or community**: "Switch cohort or community", "Create community" | Workspace (retired); Space; Group | Messages (web and mobile) |
| Messaging channel | **Group chat** | Channel (retired in learner UI); Class chat (fits only the cohort chat); Room | Messages, Manage communications |
| Cohort list tab for completed and archived cohorts | **Past** | Inactive (retired); Ended; Archived (only part of it) | Cohorts |
| Staff page for one student in one cohort | **Student page** (tab title "Student") | Student workspace; Student record; Enrollment | Buttons, back links, titles |
| `course_delivery: guided` | **Focused course with meetings** | Guided (retired). README §2 says this mode gets a name when AS-5 is designed, so treat this one as a placeholder | Cohort settings, Cohorts, cohort page |
| Enrollment status `dropped` | **Withdrawn** | Dropped | Student page Access tab |
| Inbox tab on the Updates page | **Notifications** | Inbox (README retires "Updates › Inbox"; moving it to the bell is layout work for another PR) | Updates (web and mobile) |
| Follow-up plan reasons (`trigger_type`) | Started by staff, Help request, Redo requested, Work waiting for review, No recent activity, Restarted class progress, Back after time away | Raw values (`extended_absence`) | Follow-up plan page, Support |
| Follow-up plan "evidence snapshot" | **Why this plan started** | Evidence snapshot; Evidence | Follow-up plan page, Related panel |
| Students filter for 7+ days without activity | **Needs attention (7+ days quiet)** | At risk (retired); Inactive 7+ days | Students |
| `checkpoint_completed` / `checkpoint_reopened` activity events (any block's Mark complete) | **Marked complete / Marked not complete** | Completed a learning step; Completed a checkpoint | Activity feeds (web staff, web learner, mobile) |
| Prefilled help-request draft line | **Question about: [Lesson](url)** | Course question: (retired) | Ask for help (web and mobile) |
| Paid self-paced learner with no enrollment yet | **No course yet** | Not enrolled yet (retired) | Today |
| Public description of the app | **learning app** | learning workspace; learning hub | Landing page, footer |
| Android notification channel display names (ids unchanged) | **Updates**, **Learning** | Announcements; Learning updates | Mobile |

## Left as is, for the lead

- **"…— Draft" curricula are data, not code.** No code adds the suffix. Imported curricula take the package `title` verbatim (`api/app/services/course_package_importer.rb:37` and `:43`), so it comes from a package title or a name an admin typed. Rename those curricula in production data; this PR changes no data.
- **Copy that comes from the API** still uses old words in production: the Needs attention reasons ("1 latest attempt awaiting review", "released steps unfinished", "Consider a check-in"). This PR doesn't touch the API; it needs a small API copy PR.
- **Nicer URLs** (`/learn`, `/updates`, `/admin/follow-up-plans/:id`) can be added later as aliases. Don't rename the existing routes: installed mobile builds read them.
- **"Not evidenced"** appears in both CohortWorkspace and StudentWorkspace and was left unchanged, so the two pages stay in step.

## Validation (Node 22)

- Web: both TypeScript projects, ESLint, Vitest 172 files / 1,966 tests (exit 0, no unhandled errors), Netlify script checks, production build, bundle gate.
- Mobile: typecheck, lint (0 errors, 33 warnings, same as main), Jest 127 suites / 1,157 tests.
- Both naming tests were checked against planted offenders. On web, "Open Dashboard", "Save Changes" and a `replaceAll('_', ' ')` each failed their check; on mobile, "Open Announcement Studio" failed both the glossary and sentence-case checks. They pass on the real tree.
- Impeccable 4.6.0 advisory scan of the 74 changed UI files: no findings.
- API gates were not run because the API is untouched.

## Real UI check

Agent-executed, on the synthetic QA harness (`scripts/qa/run`), Chromium at 1280×844 and 390×844. A screenshot-free Playwright script recorded document.title, headings, nav, tabs and buttons on each page twice: once on `origin/main` (`ba529b8`, in a temporary worktree) and once on this branch at `48b11f3`. The only later web change, `b1d21af`, renames the activity-event labels and the editor eyebrow; unit tests cover it. Personas: admin (1), instructor (2), program student (3), behind student (4), self-paced student (6), and signed out.

- **Label dumps:** 12 of 12 passed on each run (5 roles plus signed out, at 2 widths).
- **Retired terms:** none in any recorded label on the branch.
- **Harness smoke and sign-in specs:** 10 of 10 passed on the branch.
- **Bug found and fixed:** the first branch run showed "1 of 1 lessons" for a six-lesson week, because the count used only the filtered lessons. It now counts the whole module, with a regression test.

Not run: WebKit or Safari, real phones, Expo or the native app (the Maestro flows were updated but not run, because this host has no iOS simulator), real Clerk (the harness stubs Clerk, so the real Clerk card wasn't seen; a unit test checks the localization), and deployed builds.

Owned resources cleaned:
- The "before" harness: database `csg_qa_54352_1794752183`, PIDs 54382 and 54385.
- The "after" harness: database `csg_qa_58467_1794752472`, PIDs 58481 and 58487.
- The temporary `origin/main` worktree `../csg-glossary-before`.

The shared PostgreSQL on :5432 was already running and is still running.

## Visible labels, before → after

Only changed labels are listed. "both" means 1280 and 390 match. Rows show the browser tab title, then headings, tabs and buttons.

**admin**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/admin` | tab: Today \| CSG Learn | tab: Today · CSG Learn | both |
| `/admin/cohorts` | tab: Cohorts \| CSG Learn | tab: Cohorts · CSG Learn | both |
| `/admin/cohorts` | “Inactive 0” | “Past 0” | both |
| `/admin/cohorts/1` | tab: Cohort workspace \| CSG Learn | tab: Cohort · CSG Learn | both |
| `/admin/students` | tab: Students \| CSG Learn | tab: Students · CSG Learn | 1280 |
| `/admin/students` | “Online now 4”; “At risk (7+ days) 0” | “Online now 2”; “Needs attention (7+ days quiet) 0” | 1280 |
| `/admin/students` | tab: Students \| CSG Learn | tab: Students · CSG Learn | 390 |
| `/admin/students` | “Online now 5”; “At risk (7+ days) 0” | “Online now 3”; “Needs attention (7+ days quiet) 0” | 390 |
| `/admin/cohorts/1/students/4/overview` | tab: Student workspace \| CSG Learn | tab: Student · CSG Learn | both |
| `/admin/grading` | tab: Grading inbox \| CSG Learn | tab: Grading · CSG Learn | both |
| `/admin/grading` | “Grading inbox” | “Grading” | both |
| `/admin/grading` | “QP QA Self paced QA Lab 1.3.1 · Practice Awaiting review Latest Attempt 1 · Nov ”; “QP QA Program QA Lab 1.3.1 · Practice Awaiting review Latest Attempt 1 · Nov 16,” | “QP QA Self paced QA Lab 1.3.1 · Practice Waiting for review Latest Attempt 1 · N”; “QP QA Program QA Lab 1.3.1 · Practice Waiting for review Latest Attempt 1 · Nov ” | both |
| `/admin/support` | tab: Support \| CSG Learn | tab: Support · CSG Learn | both |
| `/admin/support` | “Interventions and scheduled follow-ups” | “Follow-up plans” | both |
| `/admin/support` | “Create case for QA Program”; “Create case for QA Self paced” | “Start follow-up plan for QA Program”; “Start follow-up plan for QA Self paced” | both |
| `/admin/interventions/1` | tab: Intervention record \| CSG Learn | tab: Follow-up plan · CSG Learn | both |
| `/admin/interventions/1` | “Evidence snapshot”; “Owned workflow”; “No recovery plan” | “Why this plan started”; “Next steps”; “No return plan” | both |
| `/admin/interventions/1` | “Save workflow”; “Evidence snapshot 0”; “Recovery plan 0”; “Create recovery plan”; “Resolve intervention” | “Save next steps”; “Why this plan started 0”; “Return plan 0”; “Create return plan”; “Resolve follow-up plan” | both |
| `/admin/help-requests/1` | tab: Help request \| CSG Learn | tab: Help request · CSG Learn | both |
| `/admin/content` | tab: Content \| CSG Learn | tab: Content · CSG Learn | both |
| `/admin/lessons/1/edit` | tab: Today \| CSG Learn | tab: Edit lesson · CSG Learn | both |
| `/admin/lessons/1/edit` | “Student Preview”; “Save Changes” | “Preview”; “Save changes” | both |
| `/admin/meetings` | tab: Private meetings \| CSG Learn | tab: Meetings · CSG Learn | both |
| `/admin/meetings` | “Private meetings”; “No cohorts have private meetings yet” | “Meetings”; “No cohorts have meetings yet” | both |
| `/admin/team` | tab: Team \| CSG Learn | tab: Team · CSG Learn | 1280 |
| `/admin/team` | “Add Team Member” | “Add team member” | 1280 |
| `/admin/team` | tab: Team \| CSG Learn | tab: Team · CSG Learn | 390 |
| `/admin/moderation` | tab: Safety queue \| CSG Learn | tab: Safety · CSG Learn | both |
| `/admin/activity` | tab: School activity \| CSG Learn | tab: School activity · CSG Learn | both |
| `/messages` | tab: Messages \| CSG Learn | tab: Messages · CSG Learn | both |
| `/messages` | “Switch workspace: QA Alumni, 1 unread” | “Switch cohort or community: QA Alumni, 1 unread” | both |
| `/announcements` | tab: Updates \| CSG Learn | tab: Updates · CSG Learn | both |
| `/announcements` | “Announcement status” | “Update status” | both |
| `/announcements` | “Announcements” | “Updates” | both |

**instructor**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/admin` | tab: Today \| CSG Learn | tab: Today · CSG Learn | both |
| `/admin/grading` | tab: Grading inbox \| CSG Learn | tab: Grading · CSG Learn | both |
| `/admin/grading` | “Grading inbox” | “Grading” | both |
| `/admin/grading` | “QP QA Self paced QA Lab 1.3.1 · Practice Awaiting review Latest Attempt 1 · Nov ”; “QP QA Program QA Lab 1.3.1 · Practice Awaiting review Latest Attempt 1 · Nov 16,” | “QP QA Self paced QA Lab 1.3.1 · Practice Waiting for review Latest Attempt 1 · N”; “QP QA Program QA Lab 1.3.1 · Practice Waiting for review Latest Attempt 1 · Nov ” | both |
| `/admin/support` | tab: Support \| CSG Learn | tab: Support · CSG Learn | both |
| `/admin/support` | “Interventions and scheduled follow-ups” | “Follow-up plans” | both |
| `/admin/support` | “Create case for QA Program”; “Create case for QA Self paced” | “Start follow-up plan for QA Program”; “Start follow-up plan for QA Self paced” | both |
| `/admin/cohorts` | tab: Cohorts \| CSG Learn | tab: Cohorts · CSG Learn | both |
| `/admin/cohorts` | “Inactive 0” | “Past 0” | both |
| `/messages` | tab: Messages \| CSG Learn | tab: Messages · CSG Learn | both |
| `/messages` | “Switch workspace: QA Alumni, 1 unread” | “Switch cohort or community: QA Alumni” | both |
| `/announcements` | tab: Updates \| CSG Learn | tab: Updates · CSG Learn | both |
| `/announcements` | “Announcement status” | “Update status” | both |
| `/announcements` | “Announcements” | “Updates” | both |

**program**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/dashboard` | tab: Today \| CSG Learn | tab: Today · CSG Learn | both |
| `/materials` | tab: Learn \| CSG Learn | tab: Learn · CSG Learn | both |
| `/materials` | “QA Week 1 Prework 0/18 blocks”; “QA Week 2 Live class 0/18 blocks”; “QA Week 3 Live class 0/18 blocks” | “QA Week 1 Prework 0 of 6 lessons”; “QA Week 2 Live class 0 of 6 lessons”; “QA Week 3 Live class 0 of 6 lessons” | both |
| `/cohorts/1` | tab: Cohort home \| CSG Learn | tab: My cohort · CSG Learn | both |
| `/lessons/3` | tab: Lesson \| CSG Learn | tab: Lesson · CSG Learn | both |
| `/lessons/3` | “Mark done” | — | both |
| `/recordings` | tab: Class recordings \| CSG Learn | tab: Recordings · CSG Learn | both |
| `/resources` | tab: Class resources \| CSG Learn | tab: Resources · CSG Learn | both |
| `/meetings` | tab: My meetings \| CSG Learn | tab: My meetings · CSG Learn | both |
| `/meetings` | “No private meetings yet” | “No meetings yet” | both |
| `/messages` | tab: Messages \| CSG Learn | tab: Messages · CSG Learn | both |
| `/announcements` | tab: Updates \| CSG Learn | tab: Updates · CSG Learn | both |
| `/announcements` | “Announcement status” | “Update status” | both |
| `/profile` | tab: Profile \| CSG Learn | tab: Profile · CSG Learn | both |

**behind**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/dashboard` | tab: Today \| CSG Learn | tab: Today · CSG Learn | both |

**self_paced**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/dashboard` | tab: Today \| CSG Learn | tab: Today · CSG Learn | both |
| `/dashboard` | “Ask a course question” | “Ask for help” | both |
| `/materials` | tab: Learn \| CSG Learn | tab: Learn · CSG Learn | both |
| `/materials` | “QA Week 1 Prework 18/18 blocks”; “QA Week 2 Live class 9/18 blocks”; “QA Week 3 Live class 0/18 blocks” | “QA Week 1 Prework 6 of 6 lessons”; “QA Week 2 Live class 3 of 6 lessons”; “QA Week 3 Live class 0 of 6 lessons” | both |

**signed-out**

| Page | Before | After | Width |
| --- | --- | --- | --- |
| `/sign-in` | tab: Sign in \| CSG Learn | tab: Sign in · CSG Learn | both |
| `/` | tab: CSG Learn \| Code School of Guam | tab: CSG Learn · Code School of Guam | both |
