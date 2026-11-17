# Where a reported message was posted, for the admin reviewing it (L-3.2
# "reported message → conversation"): a label, and a link only when the
# admin can open that conversation. Admins see every class channel, but a
# direct conversation opens only for its members, so most reported DMs stay
# a label and the quoted message.
#
# `access` loads which conversations the viewer can open for a page of
# reports in at most two queries; `json` reads from it.
class ContentReportConversation
  def self.access(viewer, reports)
    messages = reports.filter_map(&:message)
    channel_ids = messages.filter_map(&:channel_id).uniq
    dm_ids = messages.filter_map(&:direct_conversation_id).uniq
    {
      channels: channel_ids.empty? ? Set.new : Channel.visible_for(viewer).where(id: channel_ids).pluck(:id).to_set,
      dms: dm_ids.empty? ? Set.new : DirectConversation.visible_for(viewer).where(id: dm_ids).pluck(:id).to_set
    }
  end

  def self.json(message, access)
    if message.channel_id
      channel = message.channel
      available = access[:channels].include?(message.channel_id)
      label = channel ? [ "##{channel.name}", channel.cohort&.name ].compact.join(" in ") : "A class channel"
      { kind: "channel", label: label, available: available, destination: available ? RecordDestination.build(kind: "channel", id: message.channel_id, anchor: { message_id: message.id }) : nil }
    else
      available = access[:dms].include?(message.direct_conversation_id)
      cohort_name = message.direct_conversation&.cohort&.name
      { kind: "dm", label: [ "Direct conversation", cohort_name ].compact.join(" in "), available: available, destination: available ? RecordDestination.build(kind: "dm", id: message.direct_conversation_id, anchor: { message_id: message.id }) : nil }
    end
  end
end
