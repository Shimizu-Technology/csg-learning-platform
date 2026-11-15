class ApplicationJob < ActiveJob::Base
  # Enqueue only after every open Active Record transaction commits, and drop
  # the job if one rolls back. Rails 8.1 leaves this off and ignores the old
  # `config.active_job.enqueue_after_transaction_commit` setting, so it is set
  # here for every job.
  #
  # Production runs the inline adapter, where "enqueue" performs the job. A job
  # requested inside a transaction or row lock therefore runs after the commit,
  # not while the lock is held, and never runs for a write that rolled back.
  #
  # The exception is a send whose caller records it as done: see
  # enqueue_within_transaction.
  self.enqueue_after_transaction_commit = true

  WITHIN_TRANSACTION_KEY = :application_job_enqueue_within_transaction

  around_enqueue :contain_after_commit_failure

  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError

  class << self
    # Jobs requested in the block are enqueued at once, inside any open
    # transaction, as Rails does by default. Inline, they run before the block
    # returns and their failures reach the caller.
    #
    # Use it where the caller marks the send as done after requesting it: the
    # message delivery stages (#216) and intervention follow-ups. Deferring
    # those sends past the commit would leave a window, a crash or a rollback
    # after the mark, in which the send is recorded but never attempted and
    # nothing retries it. With no job runner in production (AS-6), a deferred
    # send has no persisted pending state to recover from. Deferring them safely
    # needs that state, a recovery drain, and per-recipient results (W9.1).
    #
    # Jobs that an inline job requests while it runs inside the block are also
    # enqueued at once, which matches how they ran before deferral existed.
    def enqueue_within_transaction
      previous = ActiveSupport::IsolatedExecutionState[WITHIN_TRANSACTION_KEY]
      ActiveSupport::IsolatedExecutionState[WITHIN_TRANSACTION_KEY] = true
      yield
    ensure
      ActiveSupport::IsolatedExecutionState[WITHIN_TRANSACTION_KEY] = previous
    end

    # Read by Active Job each time a job is enqueued.
    def enqueue_after_transaction_commit
      return false if ActiveSupport::IsolatedExecutionState[WITHIN_TRANSACTION_KEY]

      super
    end
  end

  private

  # Rails defers the enqueue by calling this method's super from a commit
  # callback. While this frame is on the stack the enqueue is synchronous: no
  # transaction was open, or the job was requested inside
  # enqueue_within_transaction, so failures reach the caller exactly as before.
  # A retry enqueued while the job runs re-enters this method, so the previous
  # value is restored rather than cleared.
  def raw_enqueue
    previous = @enqueuing_synchronously
    @enqueuing_synchronously = true
    super
  ensure
    @enqueuing_synchronously = previous
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
