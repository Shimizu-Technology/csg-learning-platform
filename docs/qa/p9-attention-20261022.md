# P9 attention and staff failure states

Orientation: 2026-10-22, base 3686c76 (main after #193/#194). CSG Learn serves phone-heavy learners and 1–3 staff; staff need a calm, explainable next action across cohort enrollments. Sources: audit/WORKER_BRIEF.md, audit/PLAN.md, audit/verify-staff.md T11/N-T5; docs/PRODUCT_VISION.md; SupportQueueProjection, CohortHomeProjection and DashboardController. Clerk auth, Rails API, Netlify web and Expo native are retained. AssignedLearningContent from #194 is the assigned-content authority. Open concurrent slices must be integrated before the final gate.

Acceptance: one ordered attention row per enrollment with reason, source IDs, timestamps and exact destination; healthy/new/future-only cases stay out; latest attempts never cross enrollments; due follow-ups and recovery remain visible; no progress threshold. Assigned progress and released unfinished work are labeled separately. Native eight-row limit is a preview. Staff request errors must be visible and recoverable, retaining only same-scope saved data on refresh failures. Detail failures cannot enable grading.

Experience: reuse semantic colors, cards, controls and adaptive native theme. Plain reasons and one primary action per row, wrapping on phones. No new motion; preserve focus and reduced-motion behavior.

QA owner: agent. Required affected-flow cases: attention consistency across staff home/cohort/support; exact help and submission action; healthy empty state; initial and refresh failure/retry for staff home, grading, cohort list and grading matrix; failed detail disables review; stale scope response ignored. Desktop and phone web required. Native rendering tests required; installed native/device QA not run (no simulator assigned). Isolated DB api_test_p9_attention, runtime csg_p9_attention_dev, ports 3619/5619. No provider sends or production writes.

Execution ledger: pending implementation.
