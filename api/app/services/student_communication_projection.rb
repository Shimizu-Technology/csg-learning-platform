# A bounded history of communication staff are already permitted to open.
# Cohort teaching access never grants membership in another person's DM.
class StudentCommunicationProjection
  LIMIT = 10

  def initialize(enrollment:, viewer:)
    @enrollment = enrollment
    @viewer = viewer
  end

  def call
    conversations = DirectConversation.visible_for(@viewer).where(cohort_id: @enrollment.cohort_id)
      .where(id: DirectConversationMember.where(user_id: @enrollment.user_id).select(:direct_conversation_id))
    messages = Message.visible.where(direct_conversation_id: conversations.select(:id))
      .includes(:author).order(created_at: :desc, id: :desc).limit(LIMIT)
    channels = Channel.visible_for(@viewer).where(cohort_id: @enrollment.cohort_id)
    activity = Message.visible.where(channel_id: channels.select(:id), author_id: @enrollment.user_id)
      .includes(:author, :channel).order(created_at: :desc, id: :desc).limit(LIMIT)
    meetings = PrivateMeetingBooking.where(enrollment_id: @enrollment.id)
    meetings = meetings.where(instructor_id: @viewer.id) unless @viewer.admin?
    {
      messages: messages.map { |message| message_json(message) },
      channel_activity: activity.map { |message| message_json(message).merge(channel_name: message.channel.name) },
      meetings: meetings.includes(:instructor).order(starts_at: :desc, id: :desc).limit(LIMIT).map { |meeting|
        { id: meeting.id, starts_at: meeting.starts_at, ends_at: meeting.ends_at, status: meeting.status, instructor_name: meeting.instructor.full_name }
      }
    }
  end

  private

  def message_json(message)
    { id: message.id, body: message.body, created_at: message.created_at, author_name: message.author.full_name,
      direct_conversation_id: message.direct_conversation_id, channel_id: message.channel_id, parent_message_id: message.parent_message_id }
  end
end
