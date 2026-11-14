# Production uses the in-memory async cable adapter, which only reaches
# WebSocket clients connected to the same process. See docs/DEPLOYMENT.md,
# "Real-time messaging (Action Cable)".
module ActionCableAdapterCheck
  module_function

  def web_processes
    value = ENV.fetch("WEB_CONCURRENCY", "1").to_s.strip
    return Float::INFINITY if value.casecmp?("auto")

    [ value.to_i, 1 ].max
  end

  def warning(adapter:, web_processes:, queue_adapter:)
    return unless adapter.to_s == "async"
    return unless web_processes > 1 || queue_adapter.to_s != "inline"

    "[ActionCable] async adapter with WEB_CONCURRENCY=#{ENV.fetch('WEB_CONCURRENCY', '1')} and queue adapter #{queue_adapter}: " \
      "broadcasts from other processes will not reach connected clients. Add the redis gem, then set CABLE_ADAPTER=redis and CABLE_URL."
  end
end

Rails.application.config.after_initialize do
  next unless Rails.env.production?

  adapter = ActionCable.server.config.cable&.fetch("adapter", nil).to_s
  if adapter == "redis" && Gem.loaded_specs["redis"].nil?
    raise "CABLE_ADAPTER=redis needs the redis gem in the Gemfile. See docs/DEPLOYMENT.md, Real-time messaging (Action Cable)."
  end

  message = ActionCableAdapterCheck.warning(
    adapter: adapter,
    web_processes: ActionCableAdapterCheck.web_processes,
    queue_adapter: Rails.application.config.active_job.queue_adapter
  )
  Rails.logger.warn(message) if message
end
