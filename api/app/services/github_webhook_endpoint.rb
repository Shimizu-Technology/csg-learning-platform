# Pure Rack endpoint for POST /api/v1/webhooks/github.
#
# Mounted directly in routes.rb so ActionController parameter parsing and
# Rails filtered_parameters instrumentation NEVER parse or log unauthenticated
# request bodies before rate-limit, bounded size cap, and HMAC verification.
class GithubWebhookEndpoint
  READ_CHUNK_BYTES = 16_384

  def call(env)
    request = ActionDispatch::Request.new(env)

    if rate_limit_exceeded?(request.remote_ip)
      within = ApiRateLimits::PUBLIC.fetch(:github_webhooks).fetch(:within).to_i
      return json_response(
        :too_many_requests,
        { error: "Too many requests", retry_after: within },
        extra_headers: { "retry-after" => within.to_s }
      )
    end

    if declared_content_length_too_large?(env)
      return json_response(:content_too_large, { error: "Payload too large" })
    end

    raw_bytes = read_bounded_body(env)
    return json_response(:content_too_large, { error: "Payload too large" }) if raw_bytes.nil?

    headers = {
      "X-Hub-Signature-256" => env["HTTP_X_HUB_SIGNATURE_256"],
      "X-GitHub-Delivery" => env["HTTP_X_GITHUB_DELIVERY"],
      "X-GitHub-Event" => env["HTTP_X_GITHUB_EVENT"]
    }

    result = GithubWebhookReceiver.new(raw_body: raw_bytes, headers: headers).call
    json_response(result.status, result.body)
  rescue ActiveRecord::ActiveRecordError => error
    Rails.logger.error("[GithubWebhooks] storage_error class=#{error.class.name}")
    json_response(:service_unavailable, { error: "Webhook storage temporarily unavailable" })
  end

  private

  def rate_limit_exceeded?(client_ip)
    return false if ENV.fetch("RATE_LIMIT_PUBLIC_BUCKETS", "on") == "off"

    ApiRateLimits.rate_limit_exceeded?(:github_webhooks, key: client_ip)
  end

  def declared_content_length_too_large?(env)
    raw_length = env["CONTENT_LENGTH"]
    return false if raw_length.nil? || raw_length.to_s.strip.empty?

    raw_length.to_i > GithubWebhookReceiver::MAX_PAYLOAD_BYTES
  end

  # Reads at most MAX_PAYLOAD_BYTES + 1 bytes directly from rack.input so chunked
  # or missing Content-Length oversized payloads are rejected immediately without
  # buffering the entire stream or invoking JSON parsing.
  def read_bounded_body(env)
    input = env["rack.input"]
    return "".b unless input

    input.rewind if input.respond_to?(:rewind)
    limit = GithubWebhookReceiver::MAX_PAYLOAD_BYTES + 1
    buffer = "".b

    while buffer.bytesize < limit
      chunk = input.read([ READ_CHUNK_BYTES, limit - buffer.bytesize ].min)
      break if chunk.nil? || chunk.empty?

      buffer << chunk.b
    end

    buffer.bytesize > GithubWebhookReceiver::MAX_PAYLOAD_BYTES ? nil : buffer
  end

  def json_response(status, body, extra_headers: {})
    code = Rack::Utils.status_code(status)
    headers = {
      "content-type" => "application/json; charset=utf-8",
      "cache-control" => "no-store"
    }.merge(extra_headers)
    [ code, headers, [ JSON.generate(body) ] ]
  end
end
