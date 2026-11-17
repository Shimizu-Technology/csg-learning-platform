# Separate pool: the lock pins a PgBouncer backend while task writes commit on
# the primary pool. Never wrap external sends and their claims in one transaction.
class ScheduledTaskLockRecord < ApplicationRecord
  self.abstract_class = true
  connects_to database: { writing: :primary }
end
