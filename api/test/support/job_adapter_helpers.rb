# ActiveJob::TestHelper overrides queue_adapter separately from queue_adapter=.
# Scope that override to one job and restore its raw value (including nil) so
# later tests can still inherit their adapter from ActiveJob::Base.
module JobAdapterHelpers
  def with_job_adapter(job_class, adapter)
    previous = job_class._test_adapter
    job_class.enable_test_adapter(adapter)
    yield
  ensure
    job_class.enable_test_adapter(previous)
  end
end
