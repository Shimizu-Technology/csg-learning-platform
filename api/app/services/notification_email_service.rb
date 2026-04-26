require "cgi"

class NotificationEmailService
  BRAND_NAME = "Code School of Guam"

  class << self
    def send_daily_unlock(user:, cohort:, lessons:)
      return false unless configured?
      return false if lessons.empty?

      lesson_list = lessons.map { |l| "<li style=\"margin-bottom: 8px;\">#{h(l.title)}</li>" }.join

      response = Resend::Emails.send(
        {
          from: from_email,
          to: user.email,
          subject: "New content unlocked - #{BRAND_NAME}",
          html: daily_unlock_html(
            user: user, cohort: cohort, lesson_list: lesson_list, count: lessons.size
          )
        }
      )

      Rails.logger.info("[DailyUnlock] sent to #{user.email} (#{lessons.size} lessons) response=#{response.inspect}")
      true
    rescue StandardError => e
      Rails.logger.error("[DailyUnlock] failed for #{user.email}: #{e.class} #{e.message}")
      false
    end

    def send_redo_notification(user:, submission:, feedback:)
      return false unless configured?

      content_block = submission.content_block
      lesson = content_block.lesson

      response = Resend::Emails.send(
        {
          from: from_email,
          to: user.email,
          subject: "Redo requested: #{content_block.title || lesson.title} - #{BRAND_NAME}",
          html: redo_html(
            user: user, lesson: lesson,
            exercise_title: content_block.title || lesson.title,
            feedback: feedback
          )
        }
      )

      Rails.logger.info("[RedoEmail] sent to #{user.email} for #{content_block.title}")
      true
    rescue StandardError => e
      Rails.logger.error("[RedoEmail] failed for #{user.email}: #{e.class} #{e.message}")
      false
    end

    def send_message_mention(user:, message:)
      return false unless configured?
      return false if user.email.blank?

      response = Resend::Emails.send(
        {
          from: from_email,
          to: user.email,
          subject: "#{message.author.full_name} mentioned you - #{BRAND_NAME}",
          html: mention_html(user: user, message: message)
        }
      )

      Rails.logger.info("[MentionEmail] sent to #{user.email} for message #{message.id} response=#{response.inspect}")
      true
    rescue StandardError => e
      Rails.logger.error("[MentionEmail] failed for #{user.email}: #{e.class} #{e.message}")
      false
    end

    def configured?
      if ENV["RESEND_API_KEY"].blank?
        Rails.logger.warn("[NotificationEmail] RESEND_API_KEY not configured; skipping")
        return false
      end
      if from_email.blank?
        Rails.logger.warn("[NotificationEmail] from email not configured; skipping")
        return false
      end
      true
    end

    private

    def from_email
      ENV["RESEND_FROM_EMAIL"].presence || ENV["MAILER_FROM_EMAIL"].presence
    end

    def frontend_url
      FrontendUrlResolver.resolve
    end

    def frontend_path(path)
      "#{frontend_url.to_s.sub(%r{/\z}, "")}#{path}"
    end

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    def daily_unlock_html(user:, cohort:, lesson_list:, count:)
      name = h(user.first_name.presence || user.email.split("@").first)
      <<~HTML
        <!doctype html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr><td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <tr><td style="height: 4px; background: linear-gradient(90deg, #16a34a, #2563eb); font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #16a34a; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">New Content</p>
                    <h1 style="margin: 0; color: #0f172a; font-size: 22px; font-weight: 700;">
                      #{count} new lesson#{count > 1 ? "s" : ""} unlocked!
                    </h1>
                  </td></tr>
                  <tr><td style="padding: 20px 32px 0; text-align: center;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #64748b;">
                      Hey #{name}, new content is available in <strong style="color: #0f172a;">#{h(cohort.name)}</strong>:
                    </p>
                  </td></tr>
                  <tr><td style="padding: 16px 32px 0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                      <tr><td style="padding: 16px;">
                        <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #334155; line-height: 1.6;">
                          #{lesson_list}
                        </ul>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 24px 32px 0;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr><td style="border-radius: 8px; background-color: #2563eb;">
                        <a href="#{h(frontend_url)}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700;">
                          Go to Dashboard
                        </a>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 28px 32px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                    </table>
                    <p style="margin: 16px 0 0; font-size: 11px; color: #94a3b8; text-align: center;">
                      #{h(BRAND_NAME)} &mdash; #{h(cohort.name)}
                    </p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
    end

    def redo_html(user:, lesson:, exercise_title:, feedback:)
      name = h(user.first_name.presence || user.email.split("@").first)
      <<~HTML
        <!doctype html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr><td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <tr><td style="height: 4px; background: linear-gradient(90deg, #f59e0b, #ef4444); font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #f59e0b; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Redo Requested</p>
                    <h1 style="margin: 0; color: #0f172a; font-size: 22px; font-weight: 700;">
                      #{h(exercise_title)}
                    </h1>
                  </td></tr>
                  <tr><td style="padding: 20px 32px 0; text-align: center;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #64748b;">
                      Hey #{name}, your instructor has requested a redo for this exercise.
                    </p>
                  </td></tr>
                  #{feedback.present? ? redo_feedback_section(feedback) : ""}
                  <tr><td style="padding: 24px 32px 0;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr><td style="border-radius: 8px; background-color: #2563eb;">
                        <a href="#{h(frontend_url)}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700;">
                          View Exercise
                        </a>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 28px 32px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                    </table>
                    <p style="margin: 16px 0 0; font-size: 11px; color: #94a3b8; text-align: center;">#{h(BRAND_NAME)}</p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
    end

    def redo_feedback_section(feedback)
      <<~HTML
        <tr><td style="padding: 16px 32px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
            <tr><td style="padding: 16px;">
              <p style="margin: 0 0 4px; color: #92400e; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Instructor Feedback</p>
              <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #451a03;">#{h(feedback)}</p>
            </td></tr>
          </table>
        </td></tr>
      HTML
    end

    def mention_html(user:, message:)
      name = h(user.first_name.presence || user.email.split("@").first)
      sender = h(message.author.full_name)
      context = h(message_context_label(message))
      preview = h(mention_preview(message))
      path = h(frontend_path(message_path(message)))

      <<~HTML
        <!doctype html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr><td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <tr><td style="height: 4px; background: linear-gradient(90deg, #2563eb, #ef4444); font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #2563eb; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">New Mention</p>
                    <h1 style="margin: 0; color: #0f172a; font-size: 22px; font-weight: 700;">#{sender} mentioned you</h1>
                  </td></tr>
                  <tr><td style="padding: 20px 32px 0; text-align: center;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #64748b;">
                      Hey #{name}, you were mentioned in <strong style="color: #0f172a;">#{context}</strong>.
                    </p>
                  </td></tr>
                  <tr><td style="padding: 16px 32px 0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                      <tr><td style="padding: 16px;">
                        <p style="margin: 0 0 4px; color: #2563eb; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Message Preview</p>
                        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #334155;">#{preview}</p>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 24px 32px 0;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr><td style="border-radius: 8px; background-color: #2563eb;">
                        <a href="#{path}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700;">
                          Open Conversation
                        </a>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 28px 32px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                    </table>
                    <p style="margin: 16px 0 0; font-size: 11px; color: #94a3b8; text-align: center;">#{h(BRAND_NAME)}</p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
    end

    def message_path(message)
      return "/messages/dm/#{message.direct_conversation_id}" if message.direct_message?

      "/messages/#{message.channel_id}"
    end

    def message_context_label(message)
      return "your direct messages" if message.direct_message?

      "##{message.channel&.name || 'channel'}"
    end

    def attachment_preview(message)
      count = message.message_attachments.size
      return "Sent an attachment" if count == 1
      return "Sent #{count} attachments" if count > 1

      "Sent a message"
    end

    def mention_preview(message)
      raw_preview = message.body.to_s.squish.presence || attachment_preview(message)
      strip_markdown(raw_preview).truncate(280)
    end

    def strip_markdown(value)
      value
        .to_s
        .gsub(/!\[([^\]]*)\]\([^)]+\)/, '\1')
        .gsub(/\[([^\]]+)\]\([^)]+\)/, '\1')
        .gsub(/```[\w-]*\n?/, "")
        .gsub(/```/, "")
        .gsub(/`([^`]+)`/, '\1')
        .gsub(/\*\*([^*]+)\*\*/, '\1')
        .gsub(/_([^_]+)_/, '\1')
        .gsub(/^\s{0,3}#+\s+/m, "")
        .gsub(/^\s*\d+\.\s+/m, "")
        .gsub(/^\s*>\s?/m, "")
        .gsub(/^\s*[-*]\s+/m, "")
        .squish
    end
  end
end
