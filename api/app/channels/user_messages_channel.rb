class UserMessagesChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_user
  end

  def typing(data)
    now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    return if data["active"] == true && @last_typing_broadcast_at && now - @last_typing_broadcast_at < 0.75

    delivered = MessageTypingBroadcastService.call(
      user: current_user,
      target_type: data["target_type"],
      target_id: data["target_id"],
      active: data["active"],
      thread_root_id: data["thread_root_id"]
    )
    @last_typing_broadcast_at = now if data["active"] == true && delivered
  end
end
