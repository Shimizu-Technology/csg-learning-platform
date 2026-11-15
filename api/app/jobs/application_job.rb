class ApplicationJob < ActiveJob::Base
  # Enqueue only after every open Active Record transaction commits, and drop
  # the job if one rolls back. Rails 8.1 leaves this off and ignores the old
  # `config.active_job.enqueue_after_transaction_commit` setting, so it is set
  # here for every job.
  #
  # Production runs the inline adapter, where "enqueue" performs the job. A job
  # requested inside a transaction or row lock therefore runs after the commit,
  # not while the lock is held, and never runs for a write that rolled back.
  self.enqueue_after_transaction_commit = true

  around_enqueue :contain_after_commit_failure

  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError

  private

  # Rails defers the enqueue by calling this method's super from a commit
  # callback. While this frame is on the stack the enqueue is synchronous: no
  # transaction was open, so failures reach the caller exactly as before.
  def raw_enqueue
    @enqueuing_synchronously = true
    super
  ensure
    @enqueuing_synchronously = false
  end

  # A deferred enqueue runs inside the commit callbacks of a transaction whose
  # writes are already durable. Raising there would report a saved write as a
  # failed request and skip the transaction's remaining callbacks, so a failure
  # is logged and reported like a failed job on a queue backend instead.
  # NotImplementedError is a ScriptError: the inline adapter raises it when a
  # job's retry_on tries to schedule a retry.
  def contain_after_commit_failure
    yield
  rescue StandardError, NotImplementedError => error
    raise if @enqueuing_synchronously

    Rails.logger.error(
      "[ApplicationJob] after_commit_job_failed job=#{self.class.name} job_id=#{job_id} " \
      "adapter=#{self.class.queue_adapter_name} error=#{error.class}: #{error.message}"
    )
    Rails.error.report(error, handled: true, source: "application_job.after_commit", context: { job: self.class.name, job_id: job_id })
  end
end
