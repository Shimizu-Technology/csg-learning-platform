require "cgi"

class NotificationEmailService
  class DeliveryError < StandardError; end
  class ConfigurationError < DeliveryError; end
  class DailyUnlockRejected < DeliveryError; end

  class << self
    # Sends only the lessons this learner can open in this cohort today, by the
    # same rule as the lesson page (LessonReadAccess). Returns nil, and sends
    # nothing, when none of them is readable; true when sent; false on failure.
    def send_daily_unlock(user:, cohort:, lessons:)
      return false unless configured?

      lessons = readable_lessons(user, cohort, lessons)
      return nil if lessons.empty?

      deliver_daily_unlock(user: user, cohort: cohort, lessons: lessons)
    end

    # Scheduler has already batch-loaded LearnerProgress. Recheck using those
    # same loaded assignments, avoiding a fresh enrollment lookup per recipient.
    def send_daily_unlock_for_enrollment(enrollment:, lessons:, on: LearningCalendar.today)
      modules = enrollment.module_assignments.index_by(&:module_id)
      assignments = enrollment.lesson_assignments.index_by(&:lesson_id)
      lessons = lessons.select { |lesson| LessonReadAccess.readable?(enrollment, lesson, modules[lesson.module_id], assignments[lesson.id], on: on) }
      return nil if lessons.empty?

      deliver_daily_unlock(user: enrollment.user, cohort: enrollment.cohort, lessons: lessons, raise_rejection: true)
    end

    def deliver_daily_unlock(user:, cohort:, lessons:, raise_rejection: false)
      return false unless configured?

      lesson_list = lessons.map { |lesson| daily_unlock_lesson_item(lesson, cohort) }.join

      response = Resend::Emails.send(
        {
          from: from_email,
          tags: [ { name: "application", value: "csg_learn" } ],
          to: user.email,
          subject: "New content unlocked - #{SchoolBrand.current.name}",
          html: daily_unlock_html(
            user: user, cohort: cohort, lesson_list: lesson_list, count: lessons.size
          )
        }
      )

      Rails.logger.info(
        "[DailyUnlock] delivered recipient_user_id=#{user.id} lesson_count=#{lessons.size} " \
        "provider_message_id=#{provider_message_id(response).presence || "unavailable"}"
      )
      true
    rescue StandardError => e
      # resend 1.1.0 stores HTTP status in @code (no public reader); even its
      # 422/429 classes inherit ServerError, so classify by the actual status.
      code = e.instance_variable_get(:@code) if e.is_a?(Resend::Error)
      if raise_rejection && code.is_a?(Integer) && (400..499).cover?(code) && code != 408
        raise DailyUnlockRejected, "Resend rejected daily unlock (HTTP #{code})"
      end
      Rails.logger.error(
        "[DailyUnlock] delivery_failed recipient_user_id=#{user.id} error_class=#{e.class.name}"
      )
      false
    end

    def send_redo_notification(user:, submission:, feedback:)
      return false unless configured?

      content_block = submission.content_block
      lesson = content_block.lesson

      Resend::Emails.send(
        {
          from: from_email,
          tags: [ { name: "application", value: "csg_learn" } ],
          to: user.email,
          subject: "Redo requested: #{content_block.display_title} - #{SchoolBrand.current.name}",
          html: redo_html(
            user: user, lesson: lesson,
            exercise_title: content_block.display_title,
            feedback: feedback, destination: LearningDestination.submission(submission)
          )
        }
      )

      Rails.logger.info(
        "[RedoEmail] delivered recipient_user_id=#{user.id} content_block_id=#{content_block.id}"
      )
      true
    rescue StandardError => e
      Rails.logger.error(
        "[RedoEmail] delivery_failed recipient_user_id=#{user.id} " \
        "content_block_id=#{submission.content_block_id} error_class=#{e.class.name}"
      )
      false
    end

    def send_message_mention(user:, message:)
      return false unless configured?
      return false if user.email.blank?

      response = Resend::Emails.send(
        {
          from: from_email,
          **message.provider_application_tags,
          to: user.email,
          subject: "#{message.author.full_name} mentioned you - #{SchoolBrand.current.name}",
          html: mention_html(user: user, message: message)
        },
        options: { idempotency_key: "message-mention/#{message.id}/#{user.id}" }
      )

      Rails.logger.info(
        "[MentionEmail] delivered recipient_user_id=#{user.id} message_id=#{message.id} " \
        "provider_message_id=#{provider_message_id(response).presence || "unavailable"}"
      )
      true
    rescue StandardError => e
      Rails.logger.error(
        "[MentionEmail] delivery_failed recipient_user_id=#{user.id} message_id=#{message.id} " \
        "error_class=#{e.class.name}"
      )
      false
    end

    def send_message_notification(user:, message:, notification:)
      ensure_configured!
      raise ConfigurationError, "recipient email is unavailable" if user.email.blank?

      response = Resend::Emails.send(
        {
          from: from_email,
          **notification.provider_application_tags,
          to: user.email,
          subject: "#{notification.title} - #{SchoolBrand.current.name}",
          html: message_notification_html(user: user, message: message, notification: notification)
        },
        options: { idempotency_key: "message-notification/#{notification.id}" }
      )

      provider_message_id = provider_message_id(response)
      raise DeliveryError, "email provider did not return a delivery id" if provider_message_id.blank?

      Rails.logger.info(
        "[MessageEmail] delivered message_id=#{message.id} notification_id=#{notification.id} " \
        "recipient_user_id=#{user.id} provider_message_id=#{provider_message_id}"
      )
      true
    rescue DeliveryError => e
      Rails.logger.error(
        "[MessageEmail] delivery_failed message_id=#{message.id} notification_id=#{notification.id} " \
        "recipient_user_id=#{user.id} error_class=#{e.class} error=#{e.message}"
      )
      raise
    rescue StandardError => e
      Rails.logger.error(
        "[MessageEmail] delivery_failed message_id=#{message.id} notification_id=#{notification.id} " \
        "recipient_user_id=#{user.id} error_class=#{e.class} error=#{e.message}"
      )
      raise DeliveryError, "email provider request failed: #{e.message}"
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

    def ensure_configured!
      raise ConfigurationError, "RESEND_API_KEY is not configured" if ENV["RESEND_API_KEY"].blank?
      raise ConfigurationError, "sender email is not configured" if from_email.blank?
    end

    def readable_lessons(user, cohort, lessons)
      return [] if lessons.empty?

      access = LessonReadAccess.check_many(user, lessons, cohort_id: cohort.id)
      lessons.uniq.select { |lesson| access[lesson.id]&.allowed? }
    end

    def provider_message_id(response)
      return response[:id] || response["id"] if response.respond_to?(:[])
      return response.id if response.respond_to?(:id)

      nil
    end

    def from_email
      SchoolBrand.email_sender
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

    # Each lesson opens in this cohort (L-3.7). Absolute, so it works from any mail client.
    def daily_unlock_lesson_item(lesson, cohort)
      path = RecordDestination.to_web_path(RecordDestination.build(kind: "lesson", id: lesson.id, context: { cohort_id: cohort.id }))
      %(<li style="margin-bottom: 8px;"><a href="#{h(frontend_path(path))}" target="_blank" style="color: #9c292b; font-weight: 600; text-decoration: underline;">#{h(lesson.title)}</a></li>)
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
                  <tr><td style="height: 4px; background-color: #9c292b; font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #842225; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">New Content</p>
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
                      <tr><td style="border-radius: 6px; background-color: #9c292b;">
                        <a href="#{h(frontend_path("/materials?cohort_id=#{cohort.id}"))}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700;">
                          Open Learn
                        </a>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 28px 32px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                    </table>
                    <p style="margin: 16px 0 0; font-size: 11px; color: #94a3b8; text-align: center;">
                      #{h(SchoolBrand.current.product_name)} &middot; #{h(SchoolBrand.current.name)} &mdash; #{h(cohort.name)}
                    </p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
    end

    def redo_html(user:, lesson:, exercise_title:, feedback:, destination:)
      name = h(user.first_name.presence || user.email.split("@").first)
      <<~HTML
        <!doctype html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr><td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <tr><td style="height: 4px; background-color: #9c292b; font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #92400e; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Redo Requested</p>
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
                      <tr><td style="border-radius: 6px; background-color: #9c292b;">
                        <a href="#{h(frontend_path(destination))}" target="_blank" style="display: inline-block; padding: 13px 36px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700;">
                          View Exercise
                        </a>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 28px 32px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr><td style="height: 1px; background-color: #e2e8f0; font-size: 0;">&nbsp;</td></tr>
                    </table>
                    <p style="margin: 16px 0 0; font-size: 12px; color: #5f6b7f; text-align: center;">#{h(SchoolBrand.current.product_name)} &middot; #{h(SchoolBrand.current.name)}</p>
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
                  <tr><td style="height: 4px; background-color: #9c292b; font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #842225; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">New Mention</p>
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
                        <p style="margin: 0 0 4px; color: #842225; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Message Preview</p>
                        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #334155;">#{preview}</p>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 24px 32px 0;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr><td style="border-radius: 6px; background-color: #9c292b;">
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
                    <p style="margin: 16px 0 0; font-size: 12px; color: #5f6b7f; text-align: center;">#{h(SchoolBrand.current.product_name)} &middot; #{h(SchoolBrand.current.name)}</p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
    end

    def message_path(message)
      RecordDestination.to_web_path(RecordDestination.build(
        kind: message.direct_message? ? "dm" : "channel",
        id: message.direct_message? ? message.direct_conversation_id : message.channel_id,
        anchor: { message_id: message.id }
      ))
    end

    def message_notification_html(user:, message:, notification:)
      name = h(user.first_name.presence || user.email.split("@").first)
      sender = h(message.author.full_name)
      context = h(message_context_label(message))
      title = h(notification.title)
      preview = h(strip_markdown(notification.body.presence || mention_preview(message)))
      path = h(frontend_path(message_path(message)))

      <<~HTML
        <!doctype html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
              <tr><td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <tr><td style="height: 4px; background-color: #9c292b; font-size: 0;">&nbsp;</td></tr>
                  <tr><td style="padding: 32px 32px 0; text-align: center;">
                    <p style="margin: 0 0 8px; color: #842225; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">New Message</p>
                    <h1 style="margin: 0; color: #0f172a; font-size: 22px; font-weight: 700;">#{title}</h1>
                  </td></tr>
                  <tr><td style="padding: 20px 32px 0; text-align: center;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #64748b;">
                      Hey #{name}, #{sender} sent a message in <strong style="color: #0f172a;">#{context}</strong>.
                    </p>
                  </td></tr>
                  <tr><td style="padding: 16px 32px 0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                      <tr><td style="padding: 16px;">
                        <p style="margin: 0 0 4px; color: #842225; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700;">Message Preview</p>
                        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #334155;">#{preview}</p>
                      </td></tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 24px 32px 0;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr><td style="border-radius: 6px; background-color: #9c292b;">
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
                    <p style="margin: 16px 0 0; font-size: 11px; color: #94a3b8; text-align: center;">
                      You are receiving this because message notifications are enabled in #{h(SchoolBrand.current.product_name)}.
                    </p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
      HTML
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
      strip_markdown(message.body).presence&.truncate(280) || attachment_preview(message)
    end

    def strip_markdown(value)
      MarkdownExcerpt.call(value, max_length: Float::INFINITY)
    end
  end
end
