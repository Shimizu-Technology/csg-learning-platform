# One status source: fix round 1 (2026-11-16)

PR #272, after the independent Codex review. The review evidence is outside the repository, in `/Users/agent/work/pr272-review-evidence/`.

## Bulk messaging

| Finding | Fix | Test |
|---|---|---|
| The result dialog left out recipients skipped after a 429. `sendToEach` added `not_sent` rows without calling `onProgress`, and the dialog never stored the returned list. | The dialog now stores the full returned list after the batch finishes. `sendToEach` also reports progress for skipped rows. | `MessageStudentsDialog.test.tsx`: 4 recipients, 429 on the 2nd. All four rows appear as Sent, Paused, Not sent and Not sent. `bulkMessage.test.ts` checks the progress callbacks. |
| The same learner selected in two cohorts made the second send fail with 409. The idempotency key held only the batch and user, but the server's `client_message_id` is unique per author. | Recipients are deduped by student before sending, keeping the first row selected. The dialog says "Ana is in 2 selected cohorts; one message will be sent." before sending and "...; one message sent." after. The key is now `bulk-<batch>-dm<conversation>-u<user>`. A direct conversation belongs to one cohort workspace, so two conversations can never share a key, and a retry of the same batch reopens the same conversation and reuses the key. | Dialog test: Ana is selected in cohorts 3 and 4, and Ben in cohort 3. The dialog makes 2 sends and shows the note. `bulkMessage.test.ts`: the same student in two cohorts gets two distinct keys when the dedupe is bypassed, plus `dedupeRecipients` order and counts. |

Both dialog tests fail on the round-0 code and pass now.

## LearnerActivity index

Synthetic history: 200,000 `activity_events` over about 2 years, across 20 cohorts of 75 learners. 75% are learner-made, the rest are staff-made, and they include sign-ins and grading events. The queries below are the exact SQL `LearnerActivity.for_all` produces (`.to_sql`). The test server is Postgres 16 (`agent-postgres`), and the plans were taken with a warm cache.

The scan read every event in the selected cohorts. One cohort used a bitmap scan over about 9.5k rows. Ten cohorts used a bitmap scan over 95k rows and spilled the sort to disk. All twenty cohorts used a parallel sequential scan that also spilled to disk.

The fix is the migration `20261116120000_add_learner_activity_index`: a partial btree on `(subject_user_id, cohort_id, created_at) WHERE actor_id = subject_user_id AND event_type NOT IN ('account_signed_in', 'submission_graded')`. Following R-10, it runs without a DDL transaction and uses `CONCURRENTLY`. An exact, valid same-named index is kept. An invalid one, or one with different columns, order, uniqueness or predicate, is dropped and rebuilt. `test/migrations/add_learner_activity_index_test.rb` covers five wrong definitions. It also fails if `LearnerActivity::EXCLUDED_EVENTS` drifts from the index predicate.

Execution time is the median of 7 `EXPLAIN ANALYZE` runs. The machine is shared, so expect a few ms of noise.

| Selection | Before | After |
|---|---|---|
| 1 cohort, 75 learners | 2.3 ms, bitmap heap scan on `cohort_id` | 2.1 ms, index-only scan |
| 10 cohorts, 750 learners | 24.1 ms, bitmap heap scan with an external-merge sort | 8.3 ms, index-only scan, no sort |
| 20 cohorts, 1,500 learners | 25.1 ms, parallel sequential scan with an external-merge sort | 13.5 ms, index-only scan, no sort |

After the index, the scan reads only learner-made learning events, with no heap fetches and no sort. It still reads every matching event for the selected learners, so cost grows with each learner's own history rather than with the whole cohort's. A per-enrollment `LATERAL ... ORDER BY created_at DESC LIMIT 1` would bound it fully. That rewrite is left for later because these times are already small.

### Plans (ID lists elided)

Before, 10 cohorts:
```
 GroupAggregate  (cost=6182.91..6186.62 rows=185 width=24) (actual time=34.055..38.770 rows=750 loops=1)
   Group Key: subject_user_id, cohort_id
   Buffers: shared hit=1618, temp read=293 written=294
   ->  Sort  (cost=6182.91..6183.37 rows=186 width=24) (actual time=34.042..36.258 rows=70154 loops=1)
         Sort Key: subject_user_id, cohort_id
         Sort Method: external merge  Disk: 2344kB
         Buffers: shared hit=1618, temp read=293 written=294
         ->  Bitmap Heap Scan on activity_events  (cost=1009.90..6175.90 rows=186 width=24) (actual time=2.348..23.729 rows=70154 loops=1)
               Recheck Cond: (cohort_id = ANY ('{1,2,3,4,5,6,7,8,9,10}'::bigint[]))
               Filter: (((event_type)::text <> ALL ('{account_signed_in,submission_graded}'::text[])) AND (actor_id = subject_user_id) AND (subject_user_id = ANY ('{…}'::bigint[])))
               Rows Removed by Filter: 25120
               Heap Blocks: exact=1525
               Buffers: shared hit=1615
               ->  Bitmap Index Scan on index_activity_events_on_cohort_id  (cost=0.00..1007.95 rows=95600 width=0) (actual time=2.166..2.166 rows=95274 loops=1)
                     Index Cond: (cohort_id = ANY ('{1,2,3,4,5,6,7,8,9,10}'::bigint[]))
                     Buffers: shared hit=90
 Planning:
   Buffers: shared hit=291
 Planning Time: 1.602 ms
 Execution Time: 39.644 ms
```

After, 10 cohorts:
```
 GroupAggregate  (cost=0.45..2281.71 rows=184 width=24) (actual time=0.249..22.106 rows=750 loops=1)
   Group Key: subject_user_id, cohort_id
   Buffers: shared hit=2593
   ->  Index Only Scan using index_activity_events_on_learner_activity on activity_events  (cost=0.45..2278.49 rows=185 width=24) (actual time=0.184..14.265 rows=70154 loops=1)
         Index Cond: (subject_user_id = ANY ('{…}'::bigint[]))
         Filter: (cohort_id = ANY ('{1,2,3,4,5,6,7,8,9,10}'::bigint[]))
         Heap Fetches: 0
         Buffers: shared hit=2593
 Planning:
   Buffers: shared hit=318
 Planning Time: 2.224 ms
 Execution Time: 22.202 ms
```

Before, all 20 cohorts:
```
 Finalize GroupAggregate  (cost=6732.13..6775.25 rows=462 width=24) (actual time=20.463..26.045 rows=1500 loops=1)
   Group Key: subject_user_id, cohort_id
   Buffers: shared hit=2818, temp read=584 written=586
   ->  Gather Merge  (cost=6732.13..6768.57 rows=275 width=24) (actual time=20.455..25.848 rows=3000 loops=1)
         Workers Planned: 1
         Workers Launched: 1
         Buffers: shared hit=2818, temp read=584 written=586
         ->  Partial GroupAggregate  (cost=5732.12..5737.62 rows=275 width=24) (actual time=18.608..23.571 rows=1500 loops=2)
               Group Key: subject_user_id, cohort_id
               Buffers: shared hit=2818, temp read=584 written=586
               ->  Sort  (cost=5732.12..5732.81 rows=275 width=24) (actual time=18.599..20.953 rows=69971 loops=2)
                     Sort Key: subject_user_id, cohort_id
                     Sort Method: external merge  Disk: 2464kB
                     Buffers: shared hit=2818, temp read=584 written=586
                     Worker 0:  Sort Method: external merge  Disk: 2208kB
                     ->  Parallel Seq Scan on activity_events  (cost=3.80..5720.98 rows=275 width=24) (actual time=0.030..11.271 rows=69971 loops=2)
                           Filter: (((event_type)::text <> ALL ('{account_signed_in,submission_graded}'::text[])) AND (actor_id = subject_user_id) AND (cohort_id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20}'::bigint[])) AND (subject_user_id = ANY ('{…}'::bigint[])))
                           Rows Removed by Filter: 30029
                           Buffers: shared hit=2779
 Planning:
   Buffers: shared hit=291
 Planning Time: 1.045 ms
 Execution Time: 26.574 ms
```

After, all 20 cohorts:
```
 GroupAggregate  (cost=0.47..3444.75 rows=460 width=24) (actual time=0.099..13.748 rows=1500 loops=1)
   Group Key: subject_user_id, cohort_id
   Buffers: shared hit=5181
   ->  Index Only Scan using index_activity_events_on_learner_activity on activity_events  (cost=0.47..3436.66 rows=465 width=24) (actual time=0.074..9.023 rows=139942 loops=1)
         Index Cond: (subject_user_id = ANY ('{…}'::bigint[]))
         Filter: (cohort_id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20}'::bigint[]))
         Heap Fetches: 0
         Buffers: shared hit=5181
 Planning:
   Buffers: shared hit=318
 Planning Time: 2.321 ms
 Execution Time: 13.804 ms
```
