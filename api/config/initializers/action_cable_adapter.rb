# The async cable adapter only reaches WebSocket clients connected to the same
# process. Warn loudly if production is configured in a way that splits them.
Rails.application.config.after_initialize do
  next unless Rails.env.production?

  adapter = ActionCable.server.config.cable&.fetch("adapter", nil).to_s
  next unless adapter == "async"

  web_processes = ENV.fetch("WEB_CONCURRENCY", "1").to_i
  queue_adapter = Rails.application.config.active_job.queue_adapter.to_s
  if web_processes > 1 || queue_adapter != "inline"
    Rails.logger.warn(
      "[ActionCable] async adapter with WEB_CONCURRENCY=#{web_processes} and queue adapter #{queue_adapter}: " \
      "broadcasts from other processes will not reach connected clients. Set CABLE_ADAPTER=redis and CABLE_URL."
    )
  end
end
