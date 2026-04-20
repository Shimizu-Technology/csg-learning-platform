class MessagePreference < ApplicationRecord
  belongs_to :user
  belongs_to :target, polymorphic: true

  validates :user_id, uniqueness: { scope: [ :target_type, :target_id ] }
end
