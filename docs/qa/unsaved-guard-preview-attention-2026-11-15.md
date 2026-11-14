# W1 PR 1.6 QA — November 15, 2026

Base: `90e9d435c196d7d43d8e65b67e46e70190978dcd` (current origin/main when this branch started). Tested the implementation on `codex/unsaved-guard-preview-attention`; the final commit contains this record. Agent-executed affected-flow QA, local Mac mini, Chromium at 1280×900 and 390×900. No production access or production data.

## Context and acceptance

CSG Learn serves students, instructors, and admins. This change covers staff authoring, viewing an enrolled student's learning, and following up with inactive learners. Sources: repository AGENTS.md, approved `docs/design/2026-11-platform-redesign/README.md` (context preservation, shared status, read-only preview), the four form implementations, and AttentionProjection / SupportQueueProjection / dashboard controller. Clerk authenticates users; Rails owns enrollment-scoped access and attention reasons.

Required outcomes: preserve drafts when staff cancel navigation; discard only after confirmation; successful saves stop blocking; keep preview lessons within the selected enrollment and return to that student's record; resolving help must remove only the help reason when inactivity still applies.

## Fixtures and execution

Separate local databases `csg_pr16_test` and `csg_pr16_qa`, loaded from schema. Synthetic QA data: one admin, one instructor, two joined students, one active cohort, an assigned module with three released lessons (text and exercise blocks), and an open help request for an inactive student. All users accepted the current community policy and had test Clerk identities. Local Rails ran in test mode with the test job adapter; Vite used a temporary Clerk stub and proxied to that API. No auth bypass was committed.

| Scenario | 1280 px | 390 px | Observed outcome |
| --- | --- | --- | --- |
| Lesson instructions → app Back → keep editing | Passed | Passed | Confirmation appears; text survives cancellation. |
| Save lesson, then leave | Passed | Passed | Save succeeds; app Back reaches Content without a prompt; preview displays saved content. |
| Cohort GitHub settings draft → leave → discard | Passed | Passed | Confirmation appears and discarding navigates away. |
| Personal learning-plan draft → leave → discard | Passed | Passed | Confirmation appears and discarding navigates away. |
| Announcement draft → switch view → discard | Passed | Passed | Confirmation appears before composer disappears. |
| Announcement draft → browser Back → keep editing / discard | Passed | Passed | Back is blocked, cancellation retains title, confirmed discard navigates. |
| Continue learning in student preview | Passed | Passed | Actual href stays under `/admin/cohorts/1/student-view/lessons/1?student_id=3`; read-only lesson renders without submit/completion controls. |
| Return from preview | Passed | Passed | Return link reaches `/admin/cohorts/1/students/3/overview`. |
| Resolve help via staff response dialog | Passed | Same saved result checked | Response is persisted and shown; help request becomes resolved. |
| Inactivity after resolution: all-cohort Support, cohort Support, Today, cohort home | Passed | Passed | All four still display the 7+ day inactivity reason. |

Screenshots: [desktop confirmation](pr16/unsaved-1280.png), [phone confirmation](pr16/unsaved-390.png), [desktop lesson preview](pr16/preview-1280.png), [phone lesson preview](pr16/preview-390.png), [desktop attention after resolution](pr16/attention-1280.png), [phone attention after resolution](pr16/attention-390.png).

U-0.7 did not reproduce on current main. The shared projection already calculates inactivity independently of active help requests, and Support consumes its full attention list. Added a regression that resolves through the real help-request controller and checks both Support scopes, both dashboard scopes, and cohort home. No speculative API behavior change was made.

A final phone rerun was interrupted when cleanup stopped the local API, producing a fetch error. The API and synthetic database were recreated, and the complete lesson guard/save and preview/return checks passed again at both widths before final cleanup.

## Automated evidence

- Web ESLint, `tsc -b`, complete Vitest suite: 122 files / 833 tests passed.
- Guard regression covers app links, history navigation, cancel, confirm-leave, save-clears, dirty `beforeunload`, and removal of the unload listener after save.
- Preview regression checks lesson href and both return links for the selected student.
- Rails attention projection plus help-request integration tests: 30 runs / 187 assertions; no failures, errors, or skips (`PARALLEL_WORKERS=1`).
- RuboCop on changed Ruby: passed.
- Production Vite build, Netlify routing/build-ignore/service-worker checks, and landing bundle checks: passed.
- Advisory Impeccable scan on the new guard and preview page: no findings (`[]`).

## Limits and cleanup

390 px is a Chromium viewport check, not native mobile or Safari acceptance. WebKit cannot start on this host and was not run. Browser reload/close prompting is verified by the beforeunload regression rather than an OS-level close-dialog walkthrough. Office-hours drafts use the same baseline guard; that modal's edit/save journey was not separately exercised. Full API and GitHub security checks remain CI's responsibility. Independent PR review belongs to the lead; no additional agents were started.

Shared preview tools reported unavailable and failed opening with an HTTP transport error; local Playwright was used. The lifecycle helper rejected the machine profile with `schema_version must be 1`; exact process ownership and a listener baseline were recorded manually. Task-owned API/Vite processes and Playwright browsers are stopped, temporary auth tooling is removed, and both task databases are dropped before handback. Shared PostgreSQL and other baseline services are left running. The clone remains on the task branch; PR is held for the lead and must not be merged by this agent.

## Review round 1 — November 15, 2026

Starting head: `3c2f8029480b03d17efd2d5bf7014de547809435`. Tested the review fixes on the same branch; this record and its evidence are included in the resulting commit. Agent-executed affected-flow QA uses the same synthetic seed and Clerk stub with a test-mode Rails API, now in the separate database `csg_pr225_qa`. No API source changed.

The earlier announcement switch-view expectation is superseded: query-only filter/view changes must not prompt. Hiding the composer clears its draft; pathname navigation still prompts.

| Required review scenario | Result | Evidence |
| --- | --- | --- |
| Announcement filters preserve draft, without prompting | Passed at 1280 and 390 px | [Browser log](pr16/review1-browser.txt) |
| Switch My view/Manage without prompting; reopening composer is blank | Passed at both widths | Browser log |
| Leave announcement page, cancel, then confirm discard | Passed at both widths; cancellation retains title, returning after discard is blank | Browser log |
| Edit lesson, archive, then leave | Passed at 1280 px; confirmation still appears | Browser log |
| Preview lesson URL with trailing slash | Passed at 1280 px; selected student's lesson renders | Browser log |
| Lazy route module throws | Passed at 1280 px; friendly Reload screen, no router stack screen | [Fallback screenshot](pr16/review1-route-fallback.png), browser log; temporary browser interception only |
| Edit while lesson save response is held | Passed at 1280 px; newer title survives response and still blocks leaving; reverting to submitted title is clean | [Save log](pr16/review1-save.txt) |
| Office-hours Escape, cancel, X, discard, reopen | Passed at 1280 px; cancellation retains draft and discard resets it | [Office-hours log](pr16/review1-office.txt) |
| Office-hours save, then close | Passed at 1280 px; saved session is listed and closing does not prompt | Office-hours log |

Final local gate: ESLint, `tsc -b`, full Vitest (124 files / 837 tests), and production build passed. Added automated coverage for the router fallback and PostHog capture, query-only navigation, submitted snapshot baselines, restored-plan edit entry, and preview unavailable/loading/error/read-only states. The preview test verifies the renderer receives `readOnly` and exposes no form or action controls. Advisory Impeccable scan returned `[]`.

This round does not rerun the unchanged attention-resolution journey or all original authoring journeys. Office-hours, archive, in-flight save, and route-error browser checks were desktop only. Phone checks use Chromium viewport resizing, not native Safari. WebKit remains unsupported on this machine. CI/review of the new head belongs to the lead; passing checks on the starting head are not evidence for the new head.

Shared browser status reported unavailable; opening returned `net::ERR_CONNECTION_REFUSED`. Local Playwright Chromium was used. The lifecycle helper again rejected the machine profile (`schema_version must be 1`), so listener baseline and exact process ownership were tracked manually. Task-owned Vite/API processes and Playwright browsers were stopped, temporary Clerk/config/browser scripts removed, and `csg_pr225_qa` dropped. Borrowed services, including shared PostgreSQL, remain running. The branch and clone are retained for the lead; no merge performed.
