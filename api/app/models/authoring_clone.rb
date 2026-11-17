# Durable retry receipt. It deliberately has no polymorphic association: deleting
# a draft must not allow a delayed retry to create a second copy.
class AuthoringClone < ApplicationRecord
  belongs_to :user
end
