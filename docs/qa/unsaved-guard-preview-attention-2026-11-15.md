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
