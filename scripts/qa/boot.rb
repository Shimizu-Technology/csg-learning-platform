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
