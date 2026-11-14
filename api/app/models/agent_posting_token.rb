require "digest"

# A digest-only credential that lets an admin's own assistant post messages as
# that admin through POST /api/v1/agent/messages and nowhere else.
class AgentPostingToken < ApplicationRecord
  PREFIX = "csg_ap_"
  FORMAT = /\Acsg_ap_[0-9a-f]{64}\z/
  SCOPE = "messages:write"
  ACTIVE_LIMIT = 10
  DUMMY_DIGEST = Digest::SHA256.hexdigest("invalid agent posting token").freeze

  belongs_to :user
  has_many :messages, dependent: :nullify

  normalizes :name, with: ->(name) { name.to_s.squish }

  validates :name, presence: true, length: { maximum: 60 }
  validates :token_digest, presence: true, uniqueness: true, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :scope, inclusion: { in: [ SCOPE ] }
  validate :active_admin_owner, on: :create
  validate :expiry_in_future, on: :create
  validate :active_token_limit, on: :create

  scope :newest_first, -> { order(created_at: :desc, id: :desc) }

  def self.issue!(user:, name:, expires_at: nil)
    plaintext = PREFIX + SecureRandom.hex(32)
    record = create!(user: user, name: name, expires_at: expires_at, scope: SCOPE, token_digest: Digest::SHA256.hexdigest(plaintext))
    [ record, plaintext ]
  end

  # Always hash and compare fixed-length digests, including unknown, revoked
  # and expired tokens, so response timing does not reveal which one failed.
  def self.authenticate(plaintext)
    digest = Digest::SHA256.hexdigest(plaintext.to_s)
    token = includes(:user).find_by(token_digest: digest)
    matches = ActiveSupport::SecurityUtils.secure_compare(token&.token_digest || DUMMY_DIGEST, digest)
    return unless matches && token && plaintext.to_s.match?(FORMAT)
    return unless token.usable?

    token
  end

  def usable?
    scope == SCOPE && !revoked? && !expired? && owner_active_admin?
  end

  def revoked?
    revoked_at.present?
  end

  def expired?
    expires_at.present? && expires_at <= Time.current
  end

  def status
    return "revoked" if revoked?
    return "expired" if expired?

    "active"
  end

  def revoke!
    update_column(:revoked_at, Time.current) unless revoked?
  end

  private

  def owner_active_admin?
    user&.admin? && !user.archived? && !user.invite_pending?
  end

  def active_admin_owner
    errors.add(:user, "must be an accepted active admin") unless owner_active_admin?
  end

  def expiry_in_future
    errors.add(:expires_at, "must be in the future") if expires_at.present? && expires_at <= Time.current
  end

  def active_token_limit
    return unless user

    active = user.agent_posting_tokens.where(revoked_at: nil).where("expires_at IS NULL OR expires_at > ?", Time.current).count
    errors.add(:base, "Revoke an existing assistant token before creating another (limit #{ACTIVE_LIMIT})") if active >= ACTIVE_LIMIT
  end
end
