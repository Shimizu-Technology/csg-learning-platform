# Old vs new progress comparison (AS-10)

Read-only comparison of what Today (dashboard), the weekly plan, the personal
plan, the lesson page and the staff learner view say about the same synthetic
learners, before and after one server definition of complete and next.

All data is invented. The scripts refuse anything but test mode and a local
`csg_qa_` database.

```sh
# From api/, with agent-postgres (or another local server) running:
export RAILS_ENV=test DATABASE_URL=postgres://localhost:5432/csg_qa_as10_compare
bin/rails db:create db:schema:load
bin/rails runner ../scripts/qa/progress-comparison/seed.rb

# Old answers, from a detached worktree of the base commit (the base has no dump.rb):
DUMP="$PWD/../scripts/qa/progress-comparison/dump.rb"
git worktree add --detach /tmp/as10-base origin/main
(cd /tmp/as10-base/api && bin/rails runner "$DUMP" /tmp/old.json)
# New answers, from this checkout:
bin/rails runner "$DUMP" /tmp/new.json

ruby ../scripts/qa/progress-comparison/compare.rb /tmp/old.json /tmp/new.json
bin/rails db:drop && git worktree remove /tmp/as10-base
```

`dump.rb` derives each view's status the way its client does: the server's
`learner_status` when the payload has one, otherwise the local rule
(`learnerLessonStatus`, and mobile's block-level rule on the lesson page).
`compare.rb` fails if the new server still lets two views disagree.
