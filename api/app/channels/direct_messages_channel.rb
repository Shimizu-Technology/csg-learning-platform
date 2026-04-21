class DirectMessagesChannel < ApplicationCable::Channel
  def subscribed
    conversation = DirectConversation.find_by(id: params[:direct_conversation_id])

    if conversation&.visible_to?(current_user)
      stream_for conversation
    else
      reject
    end
  end
end
