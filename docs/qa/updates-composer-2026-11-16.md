# Updates: drafts, editing and a simpler feed — November 16, 2026

W6 PR 6.4a (U-3.6, L-1.5, L-1.9, L-2.9). Branch `feat/updates-composer`, tested at `e4b1dc75` (the feature commit `59fcb69a` merged with main `b0d3309e`, which brought in #272 and #278). Synthetic data only. Executed by the implementation agent on the Mac mini.

## Acceptance

1. Staff save a draft. Only its author and admins see it, in lists, detail and search. Students and other staff never do, and nobody is notified.
2. The author or an admin reopens the draft, edits it and posts it through the existing audience check (U-0.3). The audience is notified once, after the commit, even after a double click or a retry.
3. The author or an admin edits a posted update's title and body. Readers see "Edited" with the time. Nobody is notified again, and the audience can't change; the UI says so.
4. Another instructor can't edit an update they didn't write; an admin can.
5. Readers get one feed: pinned first, then newest, with an unread marker and one "Unread only" toggle. There are no selects, no sort menu and no side explainer, and the unread count and "You're all caught up" never appear together.
6. Back from an update returns where the reader came from: Today, a cohort page, Notifications or the filtered list.
7. Mobile shows the same feed with "Edited". Drafts are filtered on the server, so installed builds never receive them.

## Automated

| Gate | Result |
| --- | --- |
| API suite, `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1` | 1742 runs, 0 failures; coverage check passed |
| RuboCop / Brakeman | no offenses / 0 warnings |
| Web typecheck, lint, vitest, build, `test:bundle`, `api:check` | all pass (vitest: 193 files, 2311 tests) |
| Mobile `tsc --noEmit`, jest | pass (135 suites, 1410 tests) |

New API tests are in `api/test/integration/update_drafts_test.rb`:

- A draft is absent for students from the list (reader and `scope=manage`), detail (403), search, notifications and Today. Another instructor on the same cohort doesn't get it in Manage or detail. The author and an admin do, with `can_edit`.
- Posting a draft calls the fan-out once, outside any open transaction (`assert_sent_after_commit`), and enqueues one push job. Two more `PATCH` requests with the same body add nothing.
- A colleague's `PATCH` (edit or post) and draft `DELETE` return 403. Admin and author succeed. An author removed from the cohort can't edit their update any more.
- Editing a posted update sets `edited_at` and `edited_by` and enqueues nothing. Existing notifications take the new title and body but keep `read_at`. Pinning is not an edit.
- After posting, changes to `audience`, `cohort_id` or `status: draft` return 422. Sending the unchanged audience back is accepted.
- `published_at` is ignored; `status: archived` on create returns 422.
- Query counts: the student feed and the instructor and admin Manage feeds send the same number of queries with one update as with five (each with an author, an editor, notifications, drafts and school-wide updates).

`search_test.rb` also checks that drafts don't appear in search for students, the author or admins. `updates_test.rb` now covers draft privacy in management detail, and `user_hard_delete_test.rb` covers the new `announcements.edited_by_id` reference.

## Browser (QA harness, Chromium)

`scripts/qa/updates-composer.spec.ts`, at 1280 and 390 px, in light and dark themes, ran 12 of 12 passing. `smoke.spec.ts` (8) also passed on the merged tree. Screenshots are in the ignored `.qa-local/updates/`.

- **Instructor (persona 2):** saved one draft that stays private and one that will be posted. Saving switched the list to Drafts with the "Draft" badge and an "N drafts" count. Edit opened "Edit draft" with the saved text. Post update showed "Post to QA Program?", since the page had no cohort scope, and confirming showed "Update posted." without the Draft badge. Edit after posting showed the locked-audience note, with no audience select and no push option. Saving showed "Changes saved… nobody was notified again" and the Edited marker. "Back to Updates" returned to the Drafts list. On the admin's seeded update, the instructor got no Edit action, even with `?edit=1` in the URL.
- **Student (persona 3):** Today listed the new update with `href=/announcements/:id?cohort_id=…&return_to=%2Fdashboard`, and the detail's "Back to Today" returned to Today. The feed has no selects and no "On Today", sort or "Clear filters" text, and the private draft is absent. The posted update shows Edited in the list and in the detail, with no Edit button. "Back to Updates" returned to the feed. The Unread only toggle turns on and off through the URL. Neither width scrolls sideways.
- **Admin (persona 1):** sees the instructor's private draft under Drafts and has Edit on the instructor's posted update.

Layout problems found and fixed during the pass: the update page repeated the list's "N drafts" count in its header, the "Unread only" chip stretched to full width on phones, and the unread dot wrapped onto its own line above long titles.

## Not run or not covered

- WebKit / mobile Safari: WebKit doesn't start on this machine, so it wasn't run.
- No native device or simulator run. The mobile change is covered by jest (Edited marker on card and detail, locked audience, no Edit without `can_edit`).
- Real push delivery and the confirmation sheet animation on a real phone.
- Two posting requests that truly run at the same moment were not tested (no two-connection test). Exactly-once posting relies on the row lock plus the draft-to-posted check under it. Sequential retries are tested.
- Screen readers.

## Cleanup

The QA harness was started twice (DBs `csg_qa_58313_1794811361` and `csg_qa_67365_1794812296`) and cleaned both times: owned PIDs stopped and DBs dropped. The test database `csg_updates_composer_test` is dropped at the end of the task.

## Fix round 1 (review of e03c351f)

Tested at merge `dfd9890c` (fixes in `d975e680`, origin/main with #275 merged in), plus the harness scenario added in the next commit.

**Two-connection API tests** (`test/integration/update_races_test.rb`, non-transactional). A second connection acts at a fixed point inside the first request. It waits until that request either finishes or is shown in `pg_locks` as waiting for a lock.

| Race | Result | On the old controller |
| --- | --- | --- |
| Admin moves an instructor's draft to a cohort the instructor doesn't teach, after the early check and before the lock | Post refused (403), still a draft in the new cohort, nobody notified | 200, posted, the other cohort notified |
| Admin edits the title and body while the author's post is fanning out | Every notification carries the new title and body | Notifications kept the old text |
| Two creates with one `client_request_id` at the same moment | One update, one fan-out, both 201 with the same id | Two updates |
| Two posts of one draft at the same moment | One fan-out, one notification per recipient | Passed (row lock already held) |

**Transactional API tests** (`update_drafts_test.rb`, `updates_test.rb`):
- Fan-out fails on the second recipient: the request raises, the update stays a draft with no notifications, and posting again notifies both recipients. Old code: posted, with one recipient left out and no way to retry.
- The push job raises with inline jobs: 200, posted, every in-app notification in place. Old code: the request failed after commit.
- The same `client_request_id` twice: one update, one push job. Another author may reuse the id, and a malformed id gets 422.
- Hidden drafts: a student and another instructor get the same status and body for `GET` as for a missing id (`404 {"error":"Update not found"}`). `PATCH` and `DELETE` also get 404.
- `can_archive`: true for a cohort colleague on a posted update they can't edit, false on drafts, on archived updates and for students.
- Query counts: the data grows once per size (1, then 5), and the student, instructor and admin feeds are each measured at both sizes.

**Web (vitest):** six new tests, all failing on the old page and composer. A post stays pending across Updates → Manage, and a second submit sends nothing. Fields are disabled while a save is pending. One `client_request_id` per new update is kept for a retry. `cohort_id` without `audience` becomes the Manage "Sent to" filter. Saving a draft switches to Drafts with a "Sent to" that includes it. Archive is shown by `can_archive`.

**Mobile (jest):** a cohort colleague sees Archive without Edit; with neither permission, neither appears. The archive test fails on the old screen.

**Browser (QA harness, Chromium 1280 and 390, light and dark):** `updates-composer.spec.ts` ran 16 of 16 passing, including the new scenario "a slow post is sent once, and the fields are locked while it saves". The POST is held, then sent to the server twice (`route.fetch()` twice). While it is held, the button reads "Posting…" and is disabled, the title is disabled and the editor is `contenteditable=false`. After leaving Manage and coming back, the composer still shows "Posting…" with the title kept. After release, one POST left the browser and a reload shows exactly one update with that title. The screenshot also shows the instructor with Archive and no Edit on the admin's seeded update.

| Gate | Result |
| --- | --- |
| API `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`, seed 27901 | 1771 runs, 0 failures |
| API, seed 61473 | 1771 runs, 0 failures |
| RuboCop / Brakeman | no offenses / 0 warnings |
| Web typecheck, lint, vitest (2324), build, `test:bundle`, `api:check` | pass |
| Mobile `tsc`, jest (1411) | pass |

Not run in this round: WebKit and mobile Safari, native devices, real push delivery, screen readers.

Cleanup: one harness run (`scripts/qa/run clean`: owned servers stopped, its DB dropped). Test databases `csg_d_upd279_dev` and `csg_d_upd279_test` were dropped. Another task's QA database, `csg_qa_94020_1794814162` (created before this run), was left untouched.

