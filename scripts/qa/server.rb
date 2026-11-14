require_relative 'boot'
require 'puma'
ActionCable.server.config.cable = { 'adapter' => 'async' } if ENV['QA_ASYNC_CABLE'] == '1'
Rails.application.reload_routes!
server = Puma::Server.new(Rails.application)
server.add_tcp_listener('127.0.0.1', Integer(ENV.fetch('QA_API_PORT')))
%w[INT TERM].each { |signal| Signal.trap(signal) { server.stop } }
server.run.join
