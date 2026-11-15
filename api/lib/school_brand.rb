require "uri"
require "mail"

# Boot-time brand configuration shares config.x.school with SchoolTime.
module SchoolBrand
  def self.configure(env = ENV)
    {
      name: env["SCHOOL_NAME"].presence || "Code School of Guam",
      product_name: env["PRODUCT_NAME"].presence || "CSG Learn",
      abbreviation: env["SCHOOL_ABBREVIATION"].presence || "CSG",
      short_name: env["SCHOOL_SHORT_NAME"].presence || "Code School",
      support_email: env["SUPPORT_EMAIL"].presence || "codeschoolofguam@gmail.com",
      site_url: public_url(env, "SCHOOL_SITE_URL", "https://codeschoolofguam.com/"),
      app_url: public_url(env, "SCHOOL_APP_URL", "https://learn.codeschoolofguam.com", origin: true).delete_suffix("/"),
      sender_name: env["EMAIL_SENDER_NAME"]&.strip.presence
    }
  end

  def self.public_url(env, key, fallback, origin: false)
    value = env[key]&.strip.presence || fallback
    uri = URI.parse(value)
    valid = uri.is_a?(URI::HTTPS) && uri.host.present? && uri.userinfo.nil? && !value.match?(/\s/)
    valid &&= uri.query.nil? && uri.fragment.nil? && [ "", "/" ].include?(uri.path) if origin
    raise ArgumentError, "#{key} must be an absolute HTTPS #{origin ? 'origin without a path' : 'URL'}" unless valid

    value
  rescue URI::InvalidURIError
    raise ArgumentError, "#{key} must be an absolute HTTPS URL"
  end

  def self.current
    Rails.application.config.x.school
  end

  # Existing sender variables may already contain a display name. Preserve it
  # unless EMAIL_SENDER_NAME explicitly requests a replacement.
  def self.email_sender
    sender = ENV["RESEND_FROM_EMAIL"].presence || ENV["MAILER_FROM_EMAIL"].presence
    return sender if sender.blank? || ENV["EMAIL_SENDER_NAME"].blank?

    Mail::Address.new(sender).tap { |mail| mail.display_name = current.sender_name }.format
  end
end
