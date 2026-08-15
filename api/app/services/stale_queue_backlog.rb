class StaleQueueBacklog
  class UnsafeStateError < StandardError; end

  EXECUTION_MODELS = {
    ready: SolidQueue::ReadyExecution,
    claimed: SolidQueue::ClaimedExecution,
    scheduled: SolidQueue::ScheduledExecution,
    blocked: SolidQueue::BlockedExecution,
    failed: SolidQueue::FailedExecution
  }.freeze

  attr_reader :cutoff

  def initialize(cutoff:)
    @cutoff = cutoff
    raise ArgumentError, "cutoff must be in the past" unless cutoff.past?
  end

  def report
    state_counts = EXECUTION_MODELS.transform_values { |model| execution_scope(model).count }

    {
      cutoff: cutoff.iso8601,
      total: pending_jobs.count,
      classes: pending_jobs.group(:class_name).count.sort.to_h,
      states: state_counts,
      unclassified: pending_jobs.count - state_counts.values.sum
    }
  end

  def purge_ready!
    snapshot = report
    unsafe_states = snapshot[:states].except(:ready).select { |_state, count| count.positive? }
    if unsafe_states.any? || snapshot[:unclassified] != 0
      raise UnsafeStateError,
        "refusing to purge: stale jobs exist outside the ready queue (#{unsafe_states}, unclassified=#{snapshot[:unclassified]})"
    end

    count = snapshot.dig(:states, :ready)
    execution_scope(SolidQueue::ReadyExecution).discard_all_in_batches
    count
  end

  private

  def pending_jobs
    SolidQueue::Job.where(finished_at: nil, created_at: ...cutoff)
  end

  def execution_scope(model)
    model.where(job_id: pending_jobs.select(:id))
  end
end
