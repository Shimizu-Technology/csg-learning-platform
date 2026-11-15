# Search everything (L-0.9)

Tested source: `dbaae86394f815bf92694278a20f2db9f7eac2d7`, including main `3b1f8c65` and dark-mode PR #262. Documentation-only commits follow this source.

CSG Learn serves learners, assigned instructors, and school administrators. This change joins the existing record pages through one authenticated search endpoint and the command palette. Product and access context came from `PRODUCT_VISION.md`, the route registry, `shellNavigation`, `LessonReadAccess`, `RecordRelated`, `RecordSummary`, conversation visibility scopes, and `FeatureSwitches`. No production data or provider credentials were used.

Acceptance was agent-executed affected-flow QA: find each available kind, respect role/cohort/release/feature/conversation boundaries, open real destinations, use the palette by keyboard, and find finished lessons while To do remains selected.

| Scenario | 1280 | 390 |
| --- | --- | --- |
| Admin: names, lessons/modules/curricula/cohorts, submissions/help/plans, channels, updates, recordings, resources | Passed | Passed |
| Instructor: assigned content and own DM; unassigned Forbidden cohort absent | Passed | Passed |
| Student: own content/work/conversation; Forbidden cohort absent | Passed | Passed |
| Palette Escape and result targets | Passed; 56px | Passed; 56px |

Queries were `QA`, `synthetic`, `fictional`, and `Forbidden`. The admin sees the negative fixture; instructors and students see zero matches for it. Admins cannot search a DM they have not joined. Per-query sections/counts and errors are in the companion JSON. The synthetic fixture extension is `scripts/qa/search-fixtures.rb`; run it against the harness's local database after startup.

Additional UI checks passed: Cmd+K/Ctrl+K, arrow selection and Enter opening `/lessons/1?cohort_id=1`, reopening to a revalidated Recent item, no horizontal overflow at 390, New cohort opening the form even from the cohort list, and Post update opening the composer. Dark-mode palette text, selection, scrim and controls were visually inspected after merging #262. Learn's finished lesson was absent before searching, appeared for `finished`, and retained To do selection. Automated tests also cover clearing search to restore the filter.

The API tests exercise populated search responses, each role's type inventory, another cohort's work/content, a classmate's own-cohort answers/help, unreleased lessons, readable modules before lesson release, switched-off features, nonmember DMs, plain snippets, exact name/handle/resource ranking, fixed query counts as lessons grow, punctuation/blank input, and the shared 900/min bucket. The endpoint returns no totals and uses `private, no-store`; the palette does not use offline search-response fallback. Recent storage contains only viewer-scoped query/id pairs and revalidates before showing titles.

Validation:

- API: 1,517 tests, 37,886 assertions with `OPENAPI_COVERAGE=1`, no failures/errors/skips; RuboCop, Brakeman (zero warnings), and Zeitwerk passed.
- Web: typecheck, ESLint, 2,128 Vitest tests, Netlify checks, production build, bundle gate, generated-type check; passed. This includes the semantic-colour lint from #262.
- Mobile: brand/URI checks, typecheck, lint, 1,172 Jest tests; passed. Existing lint warnings remain.
- Impeccable palette scan: no findings.

Expo's existing search also requests the new endpoint and opens supported destinations through the shared adapter. Existing people/message search remains available. Native Team has no directory route and returns no native destination; that surface remains W10 work. This is additive for installed builds. Native device/Safari behavior was not executed on this host; Chromium widths do not establish installed-app or Safari acceptance.

The migration builds GIN indexes concurrently, cleans interrupted invalid indexes by exact name, and requires no session-level settings or data backfill. It was applied to the owned local test database. No deploy, production migration, merge, or PR watching was performed.

The lifecycle helper rejected this host profile (`schema_version must be 1`), so resources were tracked through exact harness state/PID identities. Each owned QA server and synthetic QA database was cleaned; the shared PostgreSQL service was left running. The owned `csg_search_everything_test` database was also dropped after the final suite.
