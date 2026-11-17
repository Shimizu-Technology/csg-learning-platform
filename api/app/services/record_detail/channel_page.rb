class RecordDetail
  # A channel as a cohort record (L-5.2): what it is (Class chat or staff
  # only), its cohort, who is in it, and recent activity, with a link into
  # Messages. Staff open it only when they can open the channel itself
  # (Channel#visible_to?), in a cohort they can see.
  #
  # Members are the people who receive its messages (Channel#recipients).
  # Admins see the list; instructors see the count, with the roster on the
  # cohort's own Students tab. Recent messages show the sender, time and a
  # one-line preview; a sender the viewer has blocked, or who blocked them,
  # reads "Message hidden" (MessageJson.preview).
  class ChannelPage < Base
    RECENT = 5
    MEMBERS_SHOWN = 50
    PREVIEW_LENGTH = 140

    private

    def authorized?
      cohort_id, workspace_id = Channel.where(id: @id).pick(:cohort_id, :workspace_id)
      return false unless workspace_id
      return false if cohort_id && !scope.visible?(cohort_id)

      @channel = Channel.includes(workspace: :cohort).find(@id)
      @channel.visible_to?(@viewer)
    end

    def build
      channel = @channel
      cohort = channel.cohort
      members = channel.recipients
      staff_count = members.where(role: [ User.roles[:instructor], User.roles[:admin] ]).count
      messages = channel.messages.visible
      recent = messages.where(parent_message_id: nil).includes(:author, :message_attachments).order(created_at: :desc, id: :desc).limit(RECENT).to_a

      {
        type: "channel",
        id: channel.id,
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
        status: channel.status,
        cohort: cohort_json(cohort),
        workspace: { id: channel.workspace.id, name: channel.workspace.name, workspace_type: channel.workspace.workspace_type },
        can_manage: channel.workspace.channels_manageable_by?(@viewer),
        members: {
          count: members.count,
          staff_count: staff_count,
          list: admin? ? members.limit(MEMBERS_SHOWN).map { |user| person(user).merge(role: user.role) } : nil
        },
        activity: {
          messages_count: messages.count,
          last_7_days: messages.where(created_at: (@now - 7.days)..).count,
          last_message_at: iso(messages.maximum(:created_at)),
          recent: recent.map do |message|
            hidden = message.author_id != @viewer.id && @viewer.blocked_relationship_with?(message.author)
            { id: message.id, author: person(message.author), created_at: iso(message.created_at), hidden: hidden,
              preview: MessageJson.preview(message, blocked: hidden).to_s.squish.truncate(PREVIEW_LENGTH) }
          end
        }
      }
    end
  end
end
