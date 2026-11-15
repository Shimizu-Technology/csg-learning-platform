# Helpers for proving that external sends happen after the database commits.
#
# Production runs Active Job inline, so these tests switch to the inline
# adapter: "enqueue" performs the job, exactly as it does on Render.
module AfterCommitHelpers
  # Open application transactions on every connection pool, including the
  # dedicated message-delivery lock pool. A row lock (`with_lock`, `lock!`) or
  # transaction-scoped advisory lock is held exactly while one is open. Test
  # fixture transactions are not joinable, so they are not counted.
  def open_application_transactions
    ActiveRecord.all_open_transactions
  end

  def with_inline_jobs
    original = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :inline
    yield
  ensure
    ActiveJob::Base.queue_adapter = original
  end

  # Replaces a singleton method for the block and records, for each call,
  # whether any application transaction (and so any lock) was still open.
  def record_external_calls(target, method_name, returns: nil, calls: [])
    original = target.method(method_name)
    owned = target.singleton_methods(false).include?(method_name)
    target.define_singleton_method(method_name) do |*args, **kwargs, &block|
      calls << { target: target, args: args, kwargs: kwargs, open_transactions: ActiveRecord.all_open_transactions.size }
      returns.respond_to?(:call) ? returns.call(*args, **kwargs, &block) : returns
    end
    yield calls
  ensure
    if owned
      target.define_singleton_method(method_name, original)
    else
      target.singleton_class.send(:remove_method, method_name)
    end
  end

  def assert_sent_after_commit(calls, label = "external call")
    assert calls.any?, "expected at least one #{label}"
    held = calls.select { |call| call[:open_transactions].positive? }
    assert_empty held, "#{label} ran while a transaction or lock was still open"
  end
end
