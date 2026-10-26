require "cgi"

class UserInviteEmailService
  BRAND_NAME = "Code School of Guam"
  PRODUCT_NAME = "CSG Learn"

  class << self
    def send_invite(user:, invited_by:, invitation_url: nil)
      return false unless configured?

      button_link = invitation_url.presence || frontend_url

      response = Resend::Emails.send(
        {
          from: from_email,
          tags: [ { name: "application", value: "csg_learn" } ],
          to: user.email,
          subject: subject,
          html: invite_html(user: user, invited_by: invited_by, button_link: button_link)
        }
      )

      Rails.logger.info(
        "[InviteEmail] delivered recipient_user_id=#{user.id} " \
        "provider_message_id=#{provider_message_id(response).presence || "unavailable"}"
      )
      true
    rescue StandardError => e
      Rails.logger.error(
        "[InviteEmail] delivery_failed recipient_user_id=#{user.id} error_class=#{e.class.name}"
      )
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

    def subject
      "You're invited to #{PRODUCT_NAME} at #{BRAND_NAME}"
    end

    def provider_message_id(response)
      return response[:id] || response["id"] if response.respond_to?(:[])
      return response.id if response.respond_to?(:id)

      nil
    end

    def from_email
      ENV["RESEND_FROM_EMAIL"].presence || ENV["MAILER_FROM_EMAIL"].presence
    end

    def frontend_url
      FrontendUrlResolver.resolve
    end

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    # Email clients cannot load the app's web fonts; Georgia stands in for the
    # Newsreader headline used on the CSG site and the CSG Learn sign-in pages.
    def invite_html(user:, invited_by:, button_link:)
      inviter = h(invited_by&.full_name.presence || invited_by&.email.presence || "An administrator")
      role = h(user.role.to_s.capitalize)

      <<~HTML
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>#{h(PRODUCT_NAME)} invitation</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #faf7f0; font-family: Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #faf7f0;">
              <tr>
                <td align="center" style="padding: 40px 16px;">

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #ded7c9; border-radius: 6px; overflow: hidden;">

                    <tr>
                      <td style="padding: 32px 32px 0 32px;">
                        <p style="margin: 0 0 12px 0; color: #842225; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;">
                          #{h(BRAND_NAME)}
                        </p>
                        <h1 style="margin: 0; color: #0f172a; font-family: Newsreader, Georgia, 'Times New Roman', serif; font-size: 28px; line-height: 1.2; font-weight: 500;">
                          You're invited to #{h(PRODUCT_NAME)}
                        </h1>
                        <p style="margin: 16px 0 0 0; font-size: 16px; line-height: 1.6; color: #475569;">
                          #{inviter} added you as a <strong style="color: #0f172a;">#{role}</strong> in #{h(PRODUCT_NAME)}, #{h(BRAND_NAME)}'s learning workspace for lessons, feedback, and messages with your instructor.
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 20px 32px 0 32px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #faf7f0; border: 1px solid #ded7c9; border-radius: 6px;">
                          <tr>
                            <td style="padding: 16px;">
                              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">
                                Create your account with
                                <strong style="color: #0f172a; word-break: break-all;">#{h(user.email)}</strong>,
                                the address this invitation was sent to. If you already have an account, sign in instead.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 24px 32px 0 32px;">
                        <table role="presentation" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="border-radius: 6px; background-color: #9c292b;">
                              <a href="#{h(button_link)}" target="_blank" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 700;">
                                Accept invitation
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 16px 32px 0 32px;">
                        <p style="margin: 0 0 4px 0; font-size: 12px; color: #5f6b7f;">Or open this link in your browser:</p>
                        <p style="margin: 0; font-size: 12px; word-break: break-all;">
                          <a href="#{h(button_link)}" style="color: #842225; text-decoration: underline;">#{h(button_link)}</a>
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 28px 32px 32px 32px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                          <tr><td style="height: 1px; background-color: #ded7c9; font-size: 0;">&nbsp;</td></tr>
                        </table>
                        <p style="margin: 16px 0 0 0; font-size: 12px; line-height: 1.6; color: #5f6b7f;">
                          If you were not expecting this invitation, you can ignore this email.<br>
                          #{h(PRODUCT_NAME)} &middot; #{h(BRAND_NAME)}
                        </p>
                      </td>
                    </tr>

                  </table>

                </td>
              </tr>
            </table>
          </body>
        </html>
      HTML
    end
  end
end
