# Rails' atomic cache increments keep limits independent of application caching.
# One Render Puma process today. Before scaling, replace STORE with a shared
# increment-capable store (e.g. RedisCacheStore); no controller changes needed.
module ApiRateLimits
  STORE = ActiveSupport::Cache::MemoryStore.new(size: 16.megabytes)

  AUTHENTICATED = {
    all: { to: 1200, within: 1.minute },
    messages: { to: 120, within: 1.minute },
    help: { to: 30, within: 10.minutes },
    uploads: { to: 180, within: 1.minute },
    enrollment: { to: 180, within: 10.minutes },
    checkout: { to: 30, within: 10.minutes },
    search: { to: 900, within: 1.minute }
  }.freeze

  PUBLIC = {
    bootstrap: { to: 600, within: 1.minute },
    catalog: { to: 300, within: 1.minute },
    certificate: { to: 60, within: 1.minute },
    github_webhooks: { to: 600, within: 1.minute }
  }.freeze

  def self.rate_limit_exceeded?(name, key:)
    policy = PUBLIC.fetch(name)
    cache_key = "rate-limit:public-api:#{name}:#{key}"
    count = STORE.increment(cache_key, 1, expires_in: policy[:within])
    count.to_i > policy[:to]
  end

  def self.applies?(name, controller, action)
    case name
    when :all then true
    when :messages
      (controller.in?([ "api/v1/messages", "api/v1/agent/messages" ]) && action.in?([ "create", "create_direct" ])) ||
        (controller == "api/v1/direct_conversations" && action == "create")
    # Asking for help and replying in a help thread (staff replies and learner follow-ups) share one allowance.
    when :help then controller.in?([ "api/v1/help_requests", "api/v1/help_request_replies" ]) && action == "create"
    when :uploads
      action.include?("presign") ||
        (controller == "api/v1/uploads" && action == "multipart_initiate") ||
        (controller == "api/v1/curriculum_resources" && action == "create")
    when :enrollment
      (controller == "api/v1/users" && action.in?([ "create", "resend_invite" ])) ||
        (controller == "api/v1/enrollments" && action.in?([ "create", "bulk" ]))
    when :checkout then controller == "api/v1/course_checkouts" && action == "create"
    when :search then controller.in?([ "api/v1/messages_search", "api/v1/search" ])
    when :bootstrap then controller == "api/v1/sessions"
    when :catalog then controller == "api/v1/course_offerings"
    when :certificate then controller == "api/v1/certificates" && action == "show"
    when :github_webhooks then controller == "api/v1/github_webhooks" && action == "create"
    end
  end
end
