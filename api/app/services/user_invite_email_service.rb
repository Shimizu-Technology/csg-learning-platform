require "cgi"

class UserInviteEmailService
  BRAND_NAME = "Code School of Guam"

  class << self
    def send_invite(user:, invited_by:, invitation_url: nil)
      return false unless configured?

      button_link = invitation_url.presence || frontend_url
      display_url = frontend_url

      response = Resend::Emails.send(
        {
          from: from_email,
          to: user.email,
          subject: "You're invited to #{BRAND_NAME}",
          html: invite_html(user: user, invited_by: invited_by, button_link: button_link, display_url: display_url)
        }
      )

      Rails.logger.info("[InviteEmail] sent invite to #{user.email} response=#{response.inspect}")
      true
    rescue StandardError => e
      Rails.logger.error("[InviteEmail] failed for #{user.email}: #{e.class} #{e.message}")
      false
    end

    def configured?
      if ENV["RESEND_API_KEY"].blank?
        Rails.logger.warn("[InviteEmail] RESEND_API_KEY not configured; skipping invite email")
        return false
      end

      if from_email.blank?
        Rails.logger.warn("[InviteEmail] from email not configured; skipping invite email")
        return false
      end

      true
    end

    private

    def from_email
      ENV["RESEND_FROM_EMAIL"].presence || ENV["MAILER_FROM_EMAIL"].presence
    end

    def frontend_url
      allowed = ENV.fetch("FRONTEND_URL", "http://localhost:5173")
      allowed.split(",").first.strip
    end

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    def invite_html(user:, invited_by:, button_link:, display_url:)
      inviter = h(invited_by&.full_name.presence || invited_by&.email.presence || "An administrator")
      role = h(user.role.to_s.capitalize)

      <<~HTML
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>#{h(BRAND_NAME)} Invitation</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr>
                <td align="center" style="padding: 40px 16px;">

                  <!-- Card -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">

                    <!-- Brand accent bar -->
                    <tr><td style="height: 4px; background: linear-gradient(90deg, #2563eb, #7c3aed); font-size: 0; line-height: 0;">&nbsp;</td></tr>

                    <!-- Heading -->
                    <tr>
                      <td style="padding: 32px 32px 0 32px; text-align: center;">
                        <p style="margin: 0 0 8px 0; color: #2563eb; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">
                          Class Invitation
                        </p>
                        <h1 style="margin: 0; color: #0f172a; font-size: 22px; line-height: 1.4; font-weight: 700;">
                          You've been invited to<br>#{h(BRAND_NAME)}
                        </h1>
                      </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                      <td style="padding: 20px 32px 0 32px; text-align: center;">
                        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #64748b;">
                          #{inviter} has added you as a <strong style="color: #0f172a;">#{role}</strong>.
                        </p>
                      </td>
                    </tr>

                    <!-- Info box -->
                    <tr>
                      <td style="padding: 20px 32px 0 32px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                          <tr>
                            <td style="padding: 16px;">
                              <p style="margin: 0 0 4px 0; color: #2563eb; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">
                                Getting started
                              </p>
                              <p style="margin: 0; font-size: 13px; line-height: 1.7; color: #64748b;">
                                Click the button below to create your account using
                                <strong style="color: #0f172a;">#{h(user.email)}</strong>.
                                Choose <strong style="color: #0f172a;">Sign up</strong> if this is your first time.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- CTA -->
                    <tr>
                      <td style="padding: 24px 32px 0 32px;" align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="border-radius: 8px; background-color: #2563eb;">
                              <a href="#{h(button_link)}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; letter-spacing: 0.01em;">
                                Accept Invitation
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Fallback URL -->
                    <tr>
                      <td style="padding: 16px 32px 0 32px; text-align: center;">
                        <p style="margin: 0 0 3px 0; font-size: 11px; color: #94a3b8;">Or open this link in your browser:</p>
                        <p style="margin: 0; font-size: 11px; word-break: break-all;">
                          <a href="#{h(button_link)}" style="color: #2563eb; text-decoration: none;">#{h(display_url)}</a>
                        </p>
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="padding: 28px 32px 32px 32px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                          <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                        </table>
                        <p style="margin: 16px 0 0 0; font-size: 11px; line-height: 1.6; color: #94a3b8; text-align: center;">
                          If you already have an account, sign in normally.<br>
                          If you were not expecting this invite, you can ignore this email.
                        </p>
                      </td>
                    </tr>

                  </table>
                  <!-- /Card -->

                </td>
              </tr>
            </table>
          </body>
        </html>
      HTML
    end
  end
end
