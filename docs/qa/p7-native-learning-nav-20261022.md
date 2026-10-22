# P7 native learning navigation and enrollment context

2026-10-22. Worktree `t3-8c12729c`, branch `fix/p7-native-learning-nav`, starting base `fdc26bd`. Agent-executed affected-flow QA. Held for the integration lead; do not merge from this worker.

CSG Learn gives Code School of Guam learners a phone-friendly curriculum, progress, resources, and class history. Staff inspect each enrollment independently, including when two cohorts use the same curriculum. Clerk provides identity; Rails serves REST endpoints; Render Singapore, Netlify, Neon, and S3 provide API, web, database, and file delivery.

Sources: common `WORKER_BRIEF.md`, `PLAN.md`, and findings S4/S13/S6/T3/C5/N-T4 in the audit directory supplied by the lead; repository `docs/PRODUCT_VISION.md`, Enrollment read-access scopes, activity/resource controllers, and affected native/web screens. Brain-Dump `code-school/csg-learning-platform-plan.md` establishes reusable curricula and phone use; the 2026-10-22 owner decision explicitly allows completed enrollments to download course ZIPs during read access.

Acceptance and evidence:

| Case | Starting fixture, action, expected outcome | Automated result | Runtime result |
| --- | --- | --- | --- |
| P7-1 S4 | Delayed cohort init, same module in cohorts 4/9, completed enrollment 12: wait without an unscoped dashboard; switch query/request context; open lesson with that cohort. | Native screen regressions pass. | Native not run: baseline simulator belonged to another task; user requires component/screen tests in that case. |
| P7-2 S13 | Search lesson titles: matching lesson rows show module breadcrumb and availability/status; locked match has no action; open exact lesson with cohort; clear search restores modules. | Native screen regressions pass. | Native not run, same restriction. |
| P7-3 T3 | Staff inspect learner enrolled twice in the same curriculum: request submissions/video history for resolved enrollment cohort, open review/activity with that cohort; failed services show unavailable sections and retry. | Native screen regressions pass. | Native not run, same restriction. |
| P7-4 C5/N-T4 | Scope activity by learner/cohort/category, paginate, open authorized submission/lesson block/recording; deleted/sign-in/unavailable targets have no link; return retains category. | Native screens and web component tests pass; API scope/destination tests pass. | Web pending. Native not run, same restriction. |
| P7-5 S6 | Selected-cohort ZIP beside links shows filename/size; tap requests fresh signed URL, preparing disables duplicate taps, failure retries; signed URL never enters cached resource payload. | Native screen and API-wire tests pass. | Native external-browser download not run, same restriction. |
| P7-6 S6 owner decision | Completed enrollment lists/downloads ready ZIP during read access; signed expiry bounded by deadline; expired/paused/dropped/unrelated access rejected. | API integration tests pass; active access preserved. | Actual S3 delivery not run; storage is stubbed in API integration tests. |

Baseline regression verification: running the new screen/component/API tests against pre-fix tracked implementation reproduced 8 native failures, 2 web failures, and API missing-destination failures plus completed-download 403. Fixed implementation focused run passed 8 native tests, 2 web tests, and 22 API tests/129 assertions. Full gates and final rebase evidence pending.

Runtime baseline: borrowed simulator `BB05CB8C-002C-47DB-924D-12BF95C9ED7C` was already booted. No native device started or borrowed. Lifecycle session `01a1613c-e0c4-7290-8460-9d0b11bc71c6`. Owned DBs: `api_test_p7_native_learning_nav` and `csg_p7_native_learning_nav_dev`; drop those and only their own parallel copies at completion. Planned runtime ports API 3617/web 5617. No migrations or production writes. API destination fields are additive; clients leave unresolvable history rows readable without a link. P4 supplies exact lesson/block/recording destination handling; rebase before final gate.
