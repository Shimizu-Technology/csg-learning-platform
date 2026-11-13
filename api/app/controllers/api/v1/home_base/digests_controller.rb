module Api
  module V1
    module HomeBase
      # Deliberately isolated from Clerk's user/session authentication.
      class DigestsController < ActionController::API
        def show
          response.headers["Cache-Control"] = "no-store"
          response.headers["Vary"] = "Authorization"
          bearer = request.headers["Authorization"].to_s.match(/\ABearer ([^\s]+)\z/)
          token = HomeBaseToken.authenticate(bearer&.captures&.first)
          unless token
            render json: { error: "Unauthorized" }, status: :unauthorized
            return
          end

          digest = HomeBaseDigest.new(token.user).call
          token.update_column(:last_used_at, Time.current)
          render json: digest
        end
      end
    end
  end
end
