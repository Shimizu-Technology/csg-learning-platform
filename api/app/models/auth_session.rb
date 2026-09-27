class AuthSession < ApplicationRecord
  belongs_to :user

  validates :session_digest, presence: true, uniqueness: { scope: :user_id }, length: { is: 64 }
end
