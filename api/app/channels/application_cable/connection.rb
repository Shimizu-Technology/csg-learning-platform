module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = verified_user
    end

    private

    def verified_user
      decoded = ClerkAuth.verify(request.params[:token])
      reject_unauthorized_connection unless decoded

      user = User.find_by(clerk_id: decoded["sub"])
      if user.blank? && decoded["email"].present?
        user = User.find_by("LOWER(email) = ?", decoded["email"].downcase)
      end

      user || reject_unauthorized_connection
    end
  end
end
