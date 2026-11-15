require_relative "../app/services/frontend_url_resolver"

# Boot-time brand configuration shares config.x.school with SchoolTime.
module SchoolBrand
  def self.configure(env = ENV)
    {
      name: env["SCHOOL_NAME"].presence || "Code School of Guam",
      product_name: env["PRODUCT_NAME"].presence || "CSG Learn",
      abbreviation: env["SCHOOL_ABBREVIATION"].presence || "CSG",
      short_name: env["SCHOOL_SHORT_NAME"].presence || "Code School",
      support_email: env["SUPPORT_EMAIL"].presence || "codeschoolofguam@gmail.com",
      site_url: env["SCHOOL_SITE_URL"].presence || "https://codeschoolofguam.com/",
      app_url: FrontendUrlResolver.resolve(env: env, fallback: "https://learn.codeschoolofguam.com").delete_suffix("/"),
      sender_name: env["EMAIL_SENDER_NAME"].presence || env["SCHOOL_NAME"].presence || "Code School of Guam"
    }
  end

  def self.current
    Rails.application.config.x.school
  end

  # Existing sender variables may already contain a display name. Preserve it
  # unless EMAIL_SENDER_NAME explicitly requests a replacement.
  def self.email_sender
    sender = ENV["RESEND_FROM_EMAIL"].presence || ENV["MAILER_FROM_EMAIL"].presence
    return sender if sender.blank? || ENV["EMAIL_SENDER_NAME"].blank?

    address = sender[/<([^>]+)>/, 1] || sender
    "#{current.sender_name} <#{address}>"
  end
end
