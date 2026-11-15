# Feature switches acceptance

2026-11-15. Base: main at 52abbda. Agent-executed, affected-flow scope.
Sources: PRODUCT_VISION.md, design/2026-11-platform-redesign/README.md §1.4,
and Leon's task decision that every switch defaults On. This task keeps the
existing nav structure and existing role/enrollment restrictions.

The hub serves Code School of Guam students, instructors and admins. Clerk
bootstraps users; Rails resolves course access; React and native mobile consume
the same enrollment capabilities. Deployment is additive API schema first,
then compatible clients; no production settings or customer data were changed.

Required acceptance: defaults preserve current access; school Off hides learner
surfaces; cohort On/Off overrides and Inherit tracks school defaults; settings
persist and audit actor/time; disabled learner APIs reject writes/reads; public
catalog link honors Automatic/Always/Hidden without authentication.

## Browser evidence

Synthetic PR #227 QA harness only, isolated local database. Agent used shared
Chromium preview at 1280×844 and 390×844. No provider sends or external accounts.

Passed:
- Admin Profile → Features loads all switches On and catalog Automatic.
- Turn school Recordings, Announcements, Office hours and Help requests Off;
  Save features confirms persistence. Student Today after reload has no recording
  or update navigation and no recording catch-up card.
- Cohort 1 settings shows Inherit (Off) for the affected controls. Set those four
  controls On and save. Student Today restores recording/update links and the
  synthetic “QA counter walkthrough” recording catch-up card despite school Off.
- Disabled and restored views checked at both widths; no horizontal overflow.
  Cohort settings controls fit at 390px, with 44px select/button heights.

Screenshot description: restored desktop Today shows the personal practice plan,
recording catch-up, existing sidebar and course outline. Screenshots use only
synthetic names. The screenshot remains in local browser artifacts; no private
or production data is included in this repository.

Automated tests additionally cover resolver defaults/precedence/inheritance,
unknown-key rejection, admin authorization, audit snapshots, preservation of
other cohort settings, disabled office hours/recordings/help/announcements,
meeting-list exclusion, session/dashboard resolution, catalog modes, web
settings saving, Today/nav hiding, and native contextual-help hiding.

Native device gestures and Safari were not run on this host. Chromium at 390px
checks responsive web behavior, not an installed native app. Native typecheck
and Jest cover the mobile changes. No new mobile settings screen was added.

The lifecycle helper cannot start: “Invalid machine profile: schema_version
must be 1”. QA harness independently records exact PIDs/start signatures and its
owned database in ignored .qa-local/state.json and performs exact cleanup.
Postgres is borrowed infrastructure and remains running.

Additional cohort-level case: with school defaults On, set Private meetings and
Learning plans Off for cohort 1. Student Today omits My meetings and the personal
practice plan at 1280px and 390px. Switching both back to Inherit restores them.

Final local gate: API 1,170 tests / 7,893 assertions passed; RuboCop 520 files
clean; Brakeman zero new warnings (one existing ignored warning); Zeitwerk passed.
Web: both TypeScript projects, ESLint, 146 Vitest files / 1,342 tests, production
build and landing bundle check passed. Mobile: Node 22.22.3 (package requirement),
TypeScript and 123 Jest suites / 956 tests passed. Web used Node 20.19.5.
The advisory Impeccable scan of FeatureSettings.tsx returned an empty finding list.

Browser coverage does not include signed-out catalog navigation, native tabs,
or every switch individually; catalog mode decisions and native help hiding
have automated coverage. CI and external review are pending when the PR opens.

## Round 1 review fixes

2026-11-15, branch `feat/feature-switches`, based on `5e5b4f25`.
Agent-executed affected-flow regression acceptance; no production changes.

- Knowledge-check Off retains the entire block and its instructions, omits only
  the check, and permits ordinary completion. The same saved progress feeds
  dashboard and learning-plan completion calculations.
- GitHub sync Off resolves synced work to a text submission. The learner can
  paste code or a repository URL; submission saves completed progress and awaits
  normal review. GitHub imports remain disabled.
- Restored main's feedback-item JSON keys, removed the duplicate cohort key,
  kept staff navigation independent of learner switches, retained help history,
  checked help context before switch state, and unified global announcement
  visibility with the viewer's explicit cohort context.
- Empty feature maps save at school and cohort scope. Cohort deletion nullifies
  the audit association and retains audit snapshots. Settings writers merge
  under a row lock; module_access already held the cohort lock across the write.
- Removed Course community (AS-9); ten switches remain. Unknown stored keys are
  ignored. Interventions controls staff support-queue case/follow-up UI only.

Final local gates passed: API 1,178 tests / 7,932 assertions, RuboCop 520 files,
Brakeman zero warnings (one existing ignored warning), Zeitwerk. Scratch local
DB: `db:migrate`, `db:rollback`, `db:migrate`, including CreateSchoolSettings
up/down with transaction-local lock timeout. Web: both TypeScript projects,
ESLint, 146 Vitest files / 1,344 tests, build and test:bundle. Mobile: typecheck
and 124 Jest suites / 959 tests on Node 22.22.3. Advisory Impeccable scan of the
changed layout/settings components returned no findings.

Synthetic Chromium acceptance passed at 1280×844 and 390×844:
1. With every cohort switch Off and module GitHub required, a fresh student
   checkpoint remained visible and completed with Mark done. GitHub work showed
   a text editor and accepted a repository URL (desktop) or code (phone).
   Reload preserved Done and Submitted/awaiting review. Local DB inspection
   confirmed completed progress on both required blocks and text submission.
2. Admin and instructor navigation retained Private meetings, Student support,
   and Updates in desktop sidebar and open phone drawer. No horizontal overflow.

Editor entry used the visible Monaco model because the preview typing tool
could not edit its accessibility textbox; submission and completion used UI
buttons. Safari/native hardware were not run. Mobile tabs have role regression
coverage in Jest. No new independent review was requested: the lead owns round
2; this record does not claim the final changes have independent approval.

Cleanup: preview tab closed; both harness runs' exact owned servers stopped and
synthetic databases dropped. Separate API gate/migration databases dropped.
Shared PostgreSQL remains running. The lifecycle helper still rejects the
machine profile (`schema_version must be 1`); harness PID identities and database
ownership records were used for exact cleanup. Branch/PR retained, no merge/watch.
