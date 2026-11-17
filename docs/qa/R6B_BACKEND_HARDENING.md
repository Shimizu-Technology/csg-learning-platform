# R-6b backend hardening

2026-11-18; base `90f075e3`; implementation branch `feat/backend-hardening`.

CSG Learn serves learners, instructors, and admins through a Rails API and React client. This change concerns learner support entitlements and profile enrollment names. Sources: `docs/PRODUCT_VISION.md`, `AGENTS.md`, `Enrollment`, `EnrollmentCapabilities`, `CurriculumName`, and the CI/pooler helpers. Production uses Render/Neon with transaction pooling and prepared statements off; production database configuration is unchanged. The Mac mini has the synced shared guidance, but no Brain Dump project notes; this brief uses the supplied task and repository evidence.

## Acceptance and execution

Agent-executed affected-flow checks use disposable ASUS PostgreSQL fixtures and Rails integration requests, with mocked Clerk verification. No production records or external messages are used. No frontend behavior changes; browser/device QA and deployment verification are outside this backend PR, which must remain unmerged.

| Scenario | Expected outcome | Evidence/status |
| --- | --- | --- |
| Expired self-paced support | Lesson, dashboard, and weekly plan advertise `none`; learning writes remain available; old help responses remain readable | Pending final stress/suite results |
| Missing assigned instructor | No course questions or guided-help writes | Pending final stress/suite results |
| Existing first-open timestamp | Reading does not restart support or change its expiry | Explicit persisted-timestamp assertions; pending execution |
| Profile growth | Exactly 1 then 6 enrollments, with distinct copied curricula; flat logical SQL counts and correct cohort-qualified names | Pending final run |
| Copy privacy | Existing redaction and custom-name behavior remains intact | Existing curriculum-copy/privacy regressions in full suite |
| Transaction pooler canary | Multiple backend PIDs across autocommit; LISTEN state belongs to one backend; another backend receives no notification; production Cable avoids PostgreSQL adapter | Pooler-only test; pending PR CI |
| Prepared/unprepared pooling | Full suite passes with `max_prepared_statements=100` / `0` and matching Rails prepared-statement modes | Pending PR CI matrix |

## Investigation

`EnrollmentCapabilities` has no capabilities cache or saved `now`; it delegates to `Enrollment#instructor_support_active?`, which compares the persisted expiry directly with `Time.current`. Request-start time is used for learning-write guards, not this comparison. `record_first_course_open!` locks/reloads and exits when `first_opened_at` exists. `previous_request` creates/resolves help records without updating enrollment timestamps. PostgreSQL microsecond timestamp precision cannot make a value a full second in the past become future under a forward-moving clock.

The old test uses an adjustable wall clock and a one-second margin. A backwards VM clock correction could reverse that comparison, but the original reported failure has not yet been reproduced or attributed conclusively. The test now fixes time before fixture creation and asserts that reads preserve both persisted timestamps. This removes the wall-clock dependency without changing application entitlement behavior. Do not describe the VM-clock hypothesis as a proven historical cause.

Profile now preloads `curriculum.cohort_copy.cohort`, using the resolver's existing loaded-association path. No privacy/name logic changes. The growth fixture includes a copy at both sizes: transitioning from zero copies to copies introduces a legitimate extra cohort-preload query and would measure association shape rather than per-record growth.

Other `CurriculumName` list call sites were inspected: cohorts index/accessible already preload copies, curricula and record search batch resolver lookups, and the remaining controller/projection calls operate on one selected record. Broader unrelated list-query work is excluded.

## Validation log

Initial targeted run: expiry test passed; first profile fixture measured 9 → 10 because only the larger fixture contained copies. Fixture corrected to include a copy at both sizes. Two stress harness startup errors (missing test load path, then Minitest seed initialization) occurred before cases executed and were fixed.

Final ASUS runs, PR check evidence, reviewer status, and cleanup will be recorded before handback.
