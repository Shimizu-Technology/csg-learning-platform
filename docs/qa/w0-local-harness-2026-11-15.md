# W0 PR 0.1 verification

Agent-executed affected-flow QA on the Mac mini, based on main `1f4d058` plus
this PR's harness files. No application, schema, mobile or CI changes.

| Required scenario | Result | Evidence |
|---|---|---|
| Fresh DB/schema/synthetic seed and both servers ready | Passed | Repeated start/stop/clean cycles with generated DB names and free loopback ports |
| Fixture shape and identities | Passed | 8 users, 6 enrollments, 3 curricula, 45 completed progress records, 6 submissions, 2 plans, 54 knowledge checks, help request and intervention asserted through Rails |
| Admin Students → Messages → Updates | Passed | Chromium 1280×844 and 390×844 |
| Instructor Grading → Messages → Updates | Passed | Chromium 1280×844 and 390×844 |
| Self-paced student Learn → Messages → Updates | Passed | Chromium 1280×844 and 390×844 |
| Program student Learn → Messages → Updates | Passed | Chromium 1280×844 and 390×844 |
| Console/page errors | Passed | Zero in all eight final smoke cases |
| Non-QA/remote DB refusal | Passed | Server and seed rejected unsafe URLs before Rails boot |
| External HTTP refusal | Passed | Net::HTTP request to example.invalid raised the harness block |
| Stop retained DB; clean dropped DB | Passed | Exact final PIDs 98639/98641 absent; PostgreSQL catalog contains no csg_qa_ databases |

[Attached smoke results](w0-smoke-results.json): eight passed, zero failed,
20.3 seconds. Raw results and retained failure artifacts stay in ignored
`.qa-local/`; the attached JSON omits local paths. The earlier failed runs found
harness setup/selector mistakes (unknown model fields, hidden navigation text,
and responsive search controls); those were corrected before the final fresh run.
Default cable test adapter and optional async startup were both exercised;
real-time delivery itself was not asserted by these smoke tests.

Engineering checks passed: Chromium installation, Ruby RuboCop with the API's
configuration (three new Ruby files), web ESLint, `npx tsc -b`, and diff whitespace
validation. Harness TS is outside web's tsconfig scope by design. No full Rails,
web unit, native or provider suites were run for this tooling-only change.
Safari/native devices, Clerk login, external media, payments, email and push
remain outside this acceptance scope.

The lifecycle helper is unavailable on this mini. The runner recorded exact PIDs
and start-time/command identities, stopped those processes, and dropped only its
created databases. PostgreSQL remains available as the shared local test service.
No browser tabs or other servers were left running. Branch `qa/w0-local-harness`
and the unmerged PR are retained for the lead; review/CI status is reported in
the PR rather than inferred from these local results.
