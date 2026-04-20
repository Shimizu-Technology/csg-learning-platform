class ChannelMessagesChannel < ApplicationCable::Channel
  def subscribed
    channel = Channel.find_by(id: params[:channel_id])

    if channel&.visible_to?(current_user)
      stream_for channel
    else
      reject
    end
  end
end
