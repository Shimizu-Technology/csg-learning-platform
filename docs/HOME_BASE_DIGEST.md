# Home-base morning digest

## Context and acceptance

Implementation brief: Brain Dump `work/shimizu-tech/csg-learn-home-base-digest-brief-2026-11-13.md`.
Base: `origin/main` at `d226dbec`, November 13, 2026. The platform serves learners and
staff; this integration lets one accepted, active admin see work needing attention
without an interactive Clerk session. `PRODUCT_VISION.md`, `API_REFERENCE.md`,
`MessageReadCursor`, `SupportQueueProjection`, and the private-meeting models are the
implementation sources. Production state was deliberately not inspected.

Required affected-flow acceptance (agent executed with synthetic local fixtures):

- A digest credential reads only the digest, records use, and leaves read cursors unchanged.
- Missing, invalid, malformed, revoked, archived-owner, pending-owner, and demoted-owner
  credentials are denied. Clerk authentication remains separate, including writes.
- DM and mention boundaries handle equal timestamps, message IDs, deleted messages,
  self messages, historical timestamp-only cursors, hidden workspaces, and blocks.
- Staff queues use the latest submission attempt; graded successors remove older
  pending attempts. Help remains pending until resolved/canceled. Only the owner's
  due follow-ups and confirmed meetings starting within 48 hours are included.
- Each list stops at 20. Contact fields, grades, submission contents, help text,
  private staff notes, meeting URLs, and credentials never enter the projection.
- The morning collector reads Keychain, handles outages without stopping collection,
  refuses redirects, and reads the real local endpoint with synthetic credentials.

This is an API/collector change. Browser, native-device, printer, scheduled-job,
and production acceptance are excluded; they were not run or changed.

## Contract

`GET /api/v1/home_base/digest`, with `Authorization: Bearer csg_hb_<64 hex characters>`.
Clerk JWTs cannot read it. The integration token cannot authenticate other protected
routes and cannot write. Responses are `Cache-Control: no-store`; unauthorized
requests receive the same `401 {"error":"Unauthorized"}`. Credentials are hashed
with SHA-256 and compared with a fixed-length constant-time comparison, including
unknown/revoked credentials. Network/database timing is not a wall-clock guarantee.
There is no existing application rate-limit pattern; no new rate-limit backend is added.

The JSON contains `generated_at` and these lists (20 each):

| Key | Fields and rule |
| --- | --- |
| `unread_direct_messages` | conversation ID/name, sender name, unread count, latest unread message time, age in seconds, plain-text snippet up to 200 characters; same cursor as the app |
| `unread_mentions` | message/channel IDs, channel name, sender name, time, age, snippet; unread explicit mentions, legacy name mentions, and `@everyone`, matching delivery rules |
| `help_requests` | request ID, student name, cohort ID, status, urgency, owner ID, creation time, age; open or acknowledged, urgent first then oldest |
| `grading` | cohort/module IDs and names, latest-attempt count, oldest waiting time/age; oldest groups first |
| `upcoming_private_meetings` | booking/cohort IDs, student name, start/end; only this owner's confirmed meetings starting in the next 48 hours |
| `due_interventions` | case/cohort IDs, student name, due time, overdue seconds; active, owned, due follow-ups |
| `due_recovery_plans` | plan/cohort IDs, student name, due time, overdue seconds; active, owned, due check-ins |

All staff data is scoped to the owner's accessible cohorts. DM counts follow the
app even for a blocked sender, while blocked message text is hidden. Blocked mentions
are omitted. Obvious email addresses and phone numbers are redacted from excerpts
and labels. This does not classify arbitrary sensitive prose; message snippets remain
private student information and should stay in Leon's private brief.

Help requests are the support queue's explicit requests waiting on staff. Due owned
interventions and recovery plans are included because they have a named owner and a
scheduled action. Inferred inactivity, redo work waiting on the learner, invite state,
and broad notification bodies are omitted to keep this small and avoid private notes.

## Local validation

Use a dedicated local database, never the shared `api_development` default:

```sh
export DATABASE_URL=postgresql://localhost/csg_home_base_digest_20261113_test
export RAILS_ENV=test
: "${DATABASE_URL:?dedicated local database required}"
test "$DATABASE_URL" = postgresql://localhost/csg_home_base_digest_20261113_test && bundle exec rails db:create db:schema:load
PARALLEL_WORKERS=1 bundle exec rails test
bundle exec rubocop
bundle exec brakeman --no-pager
bundle exec bundler-audit
```

`PARALLEL_WORKERS=1` avoids this Mac's Ruby 3.3.7/pg fork crash. CI uses Linux.
The collector's `CSG_LEARN_DIGEST_URL` override accepts only the exact production
URL or the same endpoint on HTTP loopback; redirects are never followed. Tests
mock Keychain and HTTP, and the local acceptance run mocks only Keychain while
making real HTTP requests. No production request or Keychain write is needed.

## Post-merge activation — lead with Leon only

1. Merge the ready CSG PR after Leon says go. Confirm Render deployed the merge
   commit and completed `db:migrate`; verify the new endpoint returns 401 without
   a token. Do not create a credential before the deploy is confirmed.
2. In Render's shell, change to the API root if needed. Verify Leon's accepted,
   active admin user ID with Leon; substitute that numeric ID below:

   ```sh
   RAILS_ENV=production bundle exec rake 'home_base:tokens:create[LEON_ADMIN_USER_ID]'
   ```

   The command writes only a token digest, prints the credential once to stdout,
   and prints its record ID to stderr. Keep that ID for revocation; never paste
   the credential into chat, a command argument, logs, or a repository.
3. The lead uses T3 `request_secret` for secure delivery; on the Mac, run the
   following interactively and enter the token at the password prompt:

   ```sh
   security add-generic-password -U -a leon -s csg-learn-home-base-token -w
   ```

4. Integrate the reviewed morning-brief branch into its `master` checkout (check
   it is clean first). Do not change the 5:30 launchd job or invoke the scheduler.
   From `~/Desktop/ShimizuTechnology/morning-brief`, run:

   ```sh
   BRIEF_NO_PRINT=1 python3 brief.py
   ```

   Confirm `source_health.csg_learn` is `ok`, the generated private brief reflects
   the digest, and nothing printed. Only then consider activation complete.

To revoke, use the record ID (not the credential) in Render's shell:

```sh
RAILS_ENV=production bundle exec rake 'home_base:tokens:revoke[TOKEN_RECORD_ID]'
```

Rotation: create a replacement, update Keychain, run the no-print smoke test, then
revoke the old record. No production changes were performed by the implementation task.

## Acceptance record — November 13, 2026

Agent-executed affected-flow run on this isolated branch; synthetic fixtures only.
The final source is the PR head; these results were obtained from that source before
its documentation/commit metadata was finalized. No deployment was attempted.

| Case | Required observable outcome | Result / evidence |
| --- | --- | --- |
| HB01 | Digest token only; lifecycle and deny bad/revoked/ineligible credentials | Passed: request tests, fixed-length comparison test, local create/revoke rake commands |
| HB02 | Unread DMs agree with web; reading digest does not advance state | Passed: same-time ID ties, timestamp-only/no cursor, self/deleted messages, archived conversation |
| HB03 | Unread mentions match delivery and respect visibility/blocks | Passed: explicit IDs, legacy name, everyone, cursor tie, deleted/self/hidden/blocked exclusions |
| HB04 | Only actionable staff records; latest-attempt grading and time/owner boundaries | Passed: pending/resolved help, superseded submission, owned due cases, 48-hour confirmed meetings |
| HB05 | Bound every list and omit sensitive fields | Passed: 21-fixture collections capped at 20, 200-character/contact-redacted snippets, recursive field assertions |
| HB06 | Collector receives real local data and fails soft | Passed: synthetic HTTP round trip with DM/mention/help; bad-token 401; eight mocked outage/configuration/shape cases |

Rails: **1,015 tests, 6,862 assertions passed** after dependency patches, serially.
RuboCop, Brakeman (zero warnings; one existing ignored warning), bundler-audit
(no vulnerable gems), and Zeitwerk passed. Web: **119 test files / 792 tests**,
full check/build/bundle and dependency audit passed. Production-health monitor:
**4 tests passed** (test code only, no health-monitor invocation).

The starting branch's audit failures required patched Rails/Rack/XML/SSH dependencies
and RuboCop (which removes its vulnerable MCP tooling dependency). Mobile required
Expo 57 patch alignment, patched node-forge, and the upstream URI decoder fix with a
CommonJS export adapter for Expo's existing query-string consumer. No new audit
exception was added. See `mobile/vendor/decode-uri-component/README.md` for provenance
and removal criteria. Mobile: **115 suites / 850 tests** and two decoder consumer tests passed;
Expo dependency alignment, dependency audit, and iOS/Android JS exports passed.
Ruby CI jobs pin Ubuntu 24.04 because the new Ubuntu 26.04 image has no Ruby
3.3.7 binary; the application Ruby version and production configuration are unchanged.

Initial failures retained here: this Mac's parallel pg fork crash was bypassed by
serial execution; the initial ESM decoder override failed the actual CommonJS
consumer and was replaced by the tested upstream-source adapter. These were retested;
no failed run is represented as passing. Physical devices, UI journeys, production,
printing, and the scheduled 5:30 run are **not run**, outside this task's acceptance.
