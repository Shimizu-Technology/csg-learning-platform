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
