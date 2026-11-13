require "digest"

# A digest-only credential; never accepted by Clerk or persisted in plaintext.
class HomeBaseToken < ApplicationRecord
  PREFIX = "csg_hb_"
  DUMMY_DIGEST = Digest::SHA256.hexdigest("invalid home base token").freeze

  belongs_to :user
  validates :token_digest, presence: true, uniqueness: true, format: { with: /\A[0-9a-f]{64}\z/ }
  validate :active_admin_owner

  def self.issue!(user:)
    plaintext = PREFIX + SecureRandom.hex(32)
    [ create!(user: user, token_digest: Digest::SHA256.hexdigest(plaintext)), plaintext ]
  end

  # Always hash and compare fixed-length digests, including unknown/revoked tokens.
  def self.authenticate(plaintext)
    digest = Digest::SHA256.hexdigest(plaintext.to_s)
    token = includes(:user).find_by(token_digest: digest)
    matches = ActiveSupport::SecurityUtils.secure_compare(token&.token_digest || DUMMY_DIGEST, digest)
    return unless matches && token && plaintext.to_s.match?(/\Acsg_hb_[0-9a-f]{64}\z/)
    return if token.revoked_at || !token.user.admin? || token.user.archived? || token.user.invite_pending?

    token
  end

  def revoke!
    update_column(:revoked_at, Time.current)
  end

  private

  def active_admin_owner
    errors.add(:user, "must be an accepted active admin") unless user&.admin? && !user.archived? && !user.invite_pending?
  end
end
