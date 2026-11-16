# Instructor Today: fix round 1

The agent tested the staff inbox for instructors and admins. CSG's learning hub serves students and staff; Today must expose actionable help, grading, personal unread messages and follow-ups without duplicating the learner-status rules. Sources: `docs/PRODUCT_VISION.md`, `AttentionProjection`, `MessageJson`, `HelpRequest.queue_order`, and the review brief on PR #280. Branch base: `12ec00f9`; integrated main: `2b58cf0a` (#275 setup and #278 Safety/team).

Acceptance: blocked authors cannot leak message previews; urgent help precedes normal help; due interventions/check-ins have existing actions; other attention remains discoverable; paused learners retain pending help/grading; personal community DMs appear in the unscoped inbox; capped rows retain full counts; DM return context works; mobile keeps Quick actions and readable counts/times.

## Agent-executed browser acceptance

Local signed-in QA harness, synthetic instructor ID 2. Ran the fixture script `scripts/qa/today-round1-fixtures.rb` against the harness database; reset the instructor cursor between cases. Each row below passed in the shared Chromium browser at 390×844 and 1280×844, light and dark (four combinations):

- Blocked learner DM preview reads “Message hidden”.
- First ranked row is the urgent help request.
- An overdue intervention appears with Follow up; “You're caught up” is absent.
- Open message opens the exact DM. Back to Today links to `/admin?qa_user=2` and returns there.
- No horizontal document overflow.

No Safari/WebKit or physical/native-device acceptance on this Mac. Native component tests cover Quick actions, singular copy, count chips, minute precision, follow-up/pending state, and exact native actions. Provider delivery and production were outside this local check.

## Changes and regression coverage

The inbox shares `MessageJson.preview` with the DM list and loads blocked relationship IDs once. The query test grows quiet learners, office hours and bookings with inbox data, asserting 1 → 15 quiet rows and 2 → 30 upcoming rows. At 1 and 15 learners, reads remain 46 → 46 (reported local endpoint times approximately 0.046 → 0.133 s; no simulated database latency).

Each kind shows at most 20 rows while counts represent the full set. Meetings filter today's booking times in SQL, independent of subsequently moved slot times, and name the learner/cohort. Office hours name the cohort. Paused learners contribute help and ungraded submissions; quiet/follow-up eligibility still comes from the active attention projection.

OpenAPI preserves all main paths and schemas and adds the staff-only Today contract. `student_record` is required; counts declare their five supported kinds (the original four plus follow-up). Community conversation cohort fields are nullable. Generated transport files come from `web/scripts/api-types.mjs`.

Automated results and cleanup are recorded below after the final gate.
