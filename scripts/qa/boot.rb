require 'uri'
ENV['RAILS_ENV'] = 'test'
url = URI(ENV.fetch('DATABASE_URL'))
local_host = [ nil, '', 'localhost', '127.0.0.1' ].include?(url.host)
safe_name = url.path.match?(%r{\A/csg_qa_[a-z0-9_]+\z})
abort 'QA requires a local csg_qa_ database' unless %w[postgres postgresql].include?(url.scheme) && local_host && safe_name && url.query.nil?
require 'net/http'
module LocalHTTPOnly
  def connect
    raise "QA blocked external HTTP: #{address}" unless [ 'localhost', '127.0.0.1', '::1' ].include?(address)

    super
  end
end

Net::HTTP.prepend(LocalHTTPOnly)
require_relative '../../api/config/environment'
ActiveJob::Base.queue_adapter = :test
abort 'Database guard failed' unless ActiveRecord::Base.connection_db_config.database == url.path.delete_prefix('/')

# Local harness only: simulate readiness without provider credentials or calls.
CourseCheckout.define_singleton_method(:enabled?) { true } if ENV["QA_CHECKOUT_READY"] == "1"

if ENV["QA_OFFERING_PRICE_VERIFICATION"] == "1"
  ENV["STRIPE_RESTRICTED_KEY"] = "rk_test_qa_offering_price"
  prices = Object.new
  prices.define_singleton_method(:retrieve) do |id|
    amount = { "price_qa_ux2_399" => 39_900, "price_qa_ux2_499" => 49_900 }[id]
    raise Stripe::InvalidRequestError.new("Synthetic price not found", "id", code: "resource_missing") unless amount

    Stripe::Price.construct_from(active: true, type: "one_time", currency: "usd", unit_amount: amount)
  end
  CourseCheckout.define_singleton_method(:client) { Struct.new(:v1).new(Struct.new(:prices).new(prices)) }
end

# Opt-in inline invitation timing model, with no external HTTP or credentials.
if ENV['QA_INVITE_DELAY']
  delay = Float(ENV.fetch('QA_INVITE_DELAY'))
  ActiveJob::Base.queue_adapter = :inline
  ClerkInvitationService.define_method(:configured?) { true }
  ClerkInvitationService.define_method(:create_invitation) do |**|
    sleep delay
    { success: true, url: 'https://example.invalid/synthetic-invite' }
  end
  UserInviteEmailService.define_singleton_method(:configured?) { true }
  UserInviteEmailService.define_singleton_method(:send_invite) do |user:, **|
    sleep delay
    raise IOError, 'Synthetic delivery failure' if user.email.include?('delivery-fail')

    true
  end
end

# Staff reliability authorization QA: sign only synthetic local video URLs.
# This certifies access checks, not storage-provider playback.
if ENV["QA_STAFF_RELIABILITY"] == "1"
  S3Service.define_singleton_method(:configured?) { true }
  S3Service.define_singleton_method(:generate_presigned_url) { |*args, **kwargs| "http://127.0.0.1:#{ENV.fetch('QA_WEB_PORT')}/synthetic-video.mp4" }
end

# Explicit opt-in simulation at the App client boundary, with all HTTP guards
# retained. No secret or real GitHub App is needed for browser acceptance.
if ENV["QA_GITHUB_APP"] == "1"
  require_relative '../../api/test/support/fake_github_app_client'
  GithubAppClient.define_singleton_method(:new) { |**| FakeGithubAppClient.new }
  GithubAppCredentials.define_singleton_method(:app_id) { '12345' }
  GithubAppCredentials.define_singleton_method(:slug) { 'synthetic-app' }
  GithubAppCredentials.define_singleton_method(:configured?) { true }
  require_relative '../../api/test/support/fake_github_user_authorization_client'
  GithubUserAuthorizationClient.define_singleton_method(:new) { |**| FakeGithubUserAuthorizationClient.new }
  GithubAppCredentials.define_singleton_method(:client_id) { 'synthetic-client' }
  GithubAppCredentials.define_singleton_method(:oauth_configured?) { true }
  GithubAppCredentials.define_singleton_method(:user_callback_url) { "http://127.0.0.1:#{ENV.fetch('QA_WEB_PORT')}/github-app/authorize" }
end

# Wave 3 X-6.10 synthetic Actualize prework demo harness: file-backed simulated
# GitHub provider shared between local Puma and fixture CLI, with LocalHTTPOnly
# and local csg_qa_* database guards strictly enforced.
if ENV["QA_X6_DEMO"] == "1"
  require_relative 'x6_demo_fake_github_client'
  GithubAppClient.define_singleton_method(:new) { |**| X6DemoFakeGithubClient.new }
  GithubAppCredentials.define_singleton_method(:app_id) { '12345' }
  GithubAppCredentials.define_singleton_method(:slug) { 'synthetic-actualize-demo' }
  GithubAppCredentials.define_singleton_method(:configured?) { true }
  GithubAppCredentials.define_singleton_method(:webhook_secret) { 'qa-x6-demo-synthetic-webhook-secret' }
  GithubAppCredentials.define_singleton_method(:webhook_configured?) { true }
  require_relative '../../api/test/support/fake_github_user_authorization_client'
  GithubUserAuthorizationClient.define_singleton_method(:new) { |**| FakeGithubUserAuthorizationClient.new }
  GithubAppCredentials.define_singleton_method(:client_id) { 'synthetic-client' }
  GithubAppCredentials.define_singleton_method(:oauth_configured?) { true }
  web_port = ENV['QA_WEB_PORT'].presence || '5173'
  GithubAppCredentials.define_singleton_method(:user_callback_url) { "http://127.0.0.1:#{web_port}/github-app/authorize" }
end

# Revision acceptance uses the same fake provider boundary, controlled by an
# owned local fixture file. Preserve the loopback DB and HTTP guards above.
if ENV["QA_GITHUB_REVISIONS"] == "1"
  require_relative '../../api/test/support/fake_github_app_client'
  GithubAppClient.define_singleton_method(:new) do |**|
    data = JSON.parse(File.read(Rails.root.join('../.qa-local/github-submitted-source.json')))
    FakeGithubAppClient.new.tap do |client|
      client.source_text = data.fetch('text')
      client.commit_sha = data.fetch('sha')
    end
  end
  # A synthetic token satisfies the legacy controller's presence check only.
  Api::V1::CohortGradingController.define_method(:resolve_github_token) { 'synthetic-local-only' }
  GithubSyncService.prepend(Module.new do
    private

    def fetch_exercise_files(_owner, _repo_name, filenames)
      data = JSON.parse(File.read(Rails.root.join('../.qa-local/github-submitted-source.json')))
      { files: filenames.map { |name| { 'name' => name, 'text' => data.fetch('text') } }, commit_hash: data.fetch('sha'), error: nil }
    end
  end)
end

# AS-7 uses a local video in Chromium. Only storage is simulated; recording
# persistence, authorization and progress still run through Rails.
if ENV["QA_LESSON_RECORDINGS"] == "1"
  clip = Rails.root.join("..", ".qa-local", "synthetic.mp4")
  upload = Struct.new(:url, :fields)
  S3Service.define_singleton_method(:configured?) { true }
  S3Service.define_singleton_method(:generate_presigned_post) do |key, _content_type|
    upload.new("http://127.0.0.1:#{ENV.fetch('QA_WEB_PORT')}/qa-recording-upload", { "key" => key })
  end
  S3Service.define_singleton_method(:object_metadata) { |_key| { content_length: clip.size, content_type: "video/mp4" } }
  S3Service.define_singleton_method(:object_exists?) { |_key| clip.file? }
  S3Service.define_singleton_method(:generate_presigned_url) { |*_, **| "/qa-media.mp4" }
end
