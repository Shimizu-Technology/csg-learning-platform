module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = verified_user
    end

    private

    def verified_user
      user = CableToken.consume(request.params[:token])
      # A token issued just before the account was archived must not connect.
      return user if user && !user.archived?

      reject_unauthorized_connection
    end
  end
end
