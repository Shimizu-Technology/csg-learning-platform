# Include immediately after the authentication callback so identities are local
# user IDs, never unverified JWT claims or a shared campus/NAT address.
module AuthenticatedRateLimits
  extend ActiveSupport::Concern

  included do
    ApiRateLimits::AUTHENTICATED.each do |name, policy|
      rate_limit(**policy, name: name.to_s, scope: "authenticated-api",
        store: ApiRateLimits::STORE, by: -> { current_user.id },
        if: -> { current_user.present? && ApiRateLimits.applies?(name, controller_path, action_name) },
        with: -> { render_rate_limit(policy[:within]) })
    end
  end
end
