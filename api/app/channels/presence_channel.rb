class PresenceChannel < ApplicationCable::Channel
  def subscribed
    if current_user.staff?
      stream_from "presence:staff"
    else
      reject
    end
  end
end
