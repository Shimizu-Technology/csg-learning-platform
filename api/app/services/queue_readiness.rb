class QueueReadiness
  DEFAULT_MAX_READY_AGE_SECONDS = 5.minutes.to_i

  class << self
    def status
      return "not_required" unless ActiveJob::Base.queue_adapter_name == "solid_queue"

      active_worker? && backlog_current? ? "ok" : "failed"
    rescue StandardError => error
      Rails.logger.error(
        "[Readiness] check_failed check=queue error_class=#{error.class.name}"
      )
      "failed"
    end

    private

    def active_worker?
      SolidQueue::Process
        .where(kind: "Worker", last_heartbeat_at: SolidQueue.process_alive_threshold.ago..)
        .exists?
    end

    def backlog_current?
      oldest_ready_at = SolidQueue::ReadyExecution.minimum(:created_at)
      oldest_ready_at.nil? || oldest_ready_at >= max_ready_age_seconds.seconds.ago
    end

    def max_ready_age_seconds
      Integer(
        ENV.fetch("QUEUE_READINESS_MAX_READY_AGE_SECONDS", DEFAULT_MAX_READY_AGE_SECONDS),
        10
      ).tap do |value|
        raise ArgumentError, "QUEUE_READINESS_MAX_READY_AGE_SECONDS must be positive" unless value.positive?
      end
    end
  end
end
