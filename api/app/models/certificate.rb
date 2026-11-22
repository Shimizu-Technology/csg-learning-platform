class Certificate < ApplicationRecord
  CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".chars.freeze
  CODE_FORMAT = /\A[0-9A-HJKMNP-TV-Z]{12}\z/
  WORDING_VERSION = 1

  belongs_to :enrollment
  belongs_to :issued_by, class_name: "User", optional: true
  belongs_to :revoked_by, class_name: "User", optional: true

  scope :active, -> { where(revoked_at: nil) }

  validates :code, format: { with: CODE_FORMAT }
  validates :holder_name, presence: true, length: { maximum: 120 }, format: { without: /@/, message: "must not contain an email address" }
  validates :course_title, :issuer_name, :issued_at, presence: true
  normalizes :holder_name, with: ->(name) { name.gsub(/[[:space:]]+/, " ").strip }

  def self.generate_code
    SecureRandom.alphanumeric(12, chars: CODE_ALPHABET)
  end

  # Keep the allowlist independent of the table and associations.
  def verification_json
    {
      code: code,
      holder_name: holder_name,
      course_title: course_title,
      issuer_name: issuer_name,
      wording_version: wording_version,
      issued_at: issued_at,
      revoked: revoked_at.present?,
      revoked_at: revoked_at
    }
  end
end
