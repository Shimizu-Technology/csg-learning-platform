class CommunityPolicy
  VERSION = "2026-08-17".freeze
  PRIVACY_URL = "https://learn.codeschoolofguam.com/privacy".freeze
  TERMS_URL = "https://learn.codeschoolofguam.com/terms".freeze
  DELETION_URL = "https://learn.codeschoolofguam.com/account-deletion".freeze

  class << self
    def accepted?(user)
      user.community_terms_accepted_at.present? && user.community_terms_version == VERSION
    end

    def as_json(user)
      {
        version: VERSION,
        accepted: accepted?(user),
        accepted_at: user.community_terms_accepted_at,
        privacy_url: PRIVACY_URL,
        terms_url: TERMS_URL,
        deletion_url: DELETION_URL
      }
    end
  end
end
