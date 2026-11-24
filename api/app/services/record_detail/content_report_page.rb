class RecordDetail
  # One community report on Safety (L-5.2 "moderation item"): why it was
  # reported, who reported whom, the quoted message and the conversation it
  # was posted in (L-3.2 "reported message → conversation"), who resolved it,
  # the other reports about the same person, any block between the two, and
  # each person's safety counts (PersonSafety).
  #
  # Admins only, like Safety itself (ContentReportsController): an instructor
  # or student gets the same 404 as a report that doesn't exist. The message
  # is quoted as Safety quotes it, cut to 500 characters, because reviewing
  # it is the admin's job. The conversation opens only when the admin can
  # open it (ContentReportConversation), so a reported DM between two
  # learners stays the quote and a label.
  class ContentReportPage < Base
    OTHER_REPORTS_SHOWN = 5
    QUOTE_LENGTH = 500

    private

    def authorized?
      admin? && ContentReport.exists?(id: @id)
    end

    def build
      report = ContentReport.includes(:reporter, :reported_user, :reviewed_by, message: [ { channel: :cohort }, { direct_conversation: :cohort } ]).find(@id)
      message = report.message
      others = ContentReport.where(reported_user_id: report.reported_user_id).where.not(id: report.id)
      blocks = UserBlock.between(report.reporter_id, [ report.reported_user_id ]).order(:id).to_a

      {
        type: "content_report",
        id: report.id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        resolution_note: report.resolution_note,
        created_at: iso(report.created_at),
        resolved_at: iso(report.resolved_at),
        reporter: account(report.reporter),
        reported_user: account(report.reported_user),
        reviewed_by: person(report.reviewed_by),
        message: message && message_json(message, ContentReportConversation.access(@viewer, [ report ])),
        reporter_safety: PersonSafety.for(viewer: @viewer, user_id: report.reporter_id),
        reported_user_safety: PersonSafety.for(viewer: @viewer, user_id: report.reported_user_id),
        other_reports_count: others.count,
        other_reports: others.includes(:reporter).recent_first.limit(OTHER_REPORTS_SHOWN).map do |other|
          { id: other.id, reason: other.reason, status: other.status, created_at: iso(other.created_at), reporter: person(other.reporter) }
        end,
        blocks_between: blocks.map { |block| { blocker_id: block.blocker_id, blocked_user_id: block.blocked_user_id, created_at: iso(block.created_at) } }
      }
    end

    def account(user)
      person(user).merge(role: user.role, archived: user.archived?)
    end

    def message_json(message, access)
      {
        id: message.id,
        body: message.body.to_s.truncate(QUOTE_LENGTH),
        created_at: iso(message.created_at),
        deleted: message.deleted?,
        reply: message.parent_message_id.present?,
        attachments_count: message.message_attachments.size,
        conversation: ContentReportConversation.json(message, access)
      }
    end
  end
end
