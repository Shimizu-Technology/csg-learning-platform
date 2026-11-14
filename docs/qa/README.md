# QA records and reusable local harness

Use [the local QA harness](../../scripts/qa/README.md) for signed-in role checks
against a disposable synthetic database. Earlier dated records describe temporary
harnesses; those instructions and any references to production curriculum are
historical and must not be reused as seed sources.

The learning hub serves students (program, self-paced and alumni), instructors
and admins. The harness exercises the real web router and Rails authorization,
replacing only Clerk identity. Context sources: `AGENTS.md`, `web/src/App.tsx`,
`api/app/models/enrollment.rb`, and the dated QA records in this directory.

W0 acceptance: fresh start, eight deterministic personas, curriculum/communication
fixtures, signed-in admin/instructor/program/self-paced pages at both viewport
widths, no browser errors, and exact process/database cleanup. Execution owner:
implementation agent on the Mac mini. Results are recorded in the PR and the
W0 verification record; physical devices and external integrations are excluded.
