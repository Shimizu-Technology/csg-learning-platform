# Holds message delivery advisory locks on connections separate from the
# request's work connection. Production reaches Neon through a transaction-mode
# pooler, so a lock must live inside an open transaction on its own connection:
# only an open transaction pins one PostgreSQL backend until the lock releases.
class MessageDeliveryLockRecord < ApplicationRecord
  self.abstract_class = true

  connects_to database: { writing: :primary }
end
