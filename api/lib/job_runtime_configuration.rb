class JobRuntimeConfiguration
  SUPPORTED_ADAPTERS = %w[inline solid_queue].freeze

  attr_reader :adapter_name

  def initialize(environment = ENV)
    @adapter_name = environment.fetch("ACTIVE_JOB_QUEUE_ADAPTER", "inline")
    @worker_provisioned = environment["SOLID_QUEUE_WORKER_PROVISIONED"] == "true"
    @queue_in_puma = environment["SOLID_QUEUE_IN_PUMA"] == "true"

    validate!
  end

  def adapter
    adapter_name.to_sym
  end

  def execution_path
    return "inline" if adapter_name == "inline"
    return "dedicated_worker" if worker_provisioned?

    "puma"
  end

  private

  def worker_provisioned?
    @worker_provisioned
  end

  def queue_in_puma?
    @queue_in_puma
  end

  def validate!
    unless SUPPORTED_ADAPTERS.include?(adapter_name)
      raise ArgumentError, "ACTIVE_JOB_QUEUE_ADAPTER must be one of: #{SUPPORTED_ADAPTERS.join(", ")}"
    end

    if adapter_name == "inline"
      if worker_provisioned? || queue_in_puma?
        raise ArgumentError,
          "Inline jobs require SOLID_QUEUE_WORKER_PROVISIONED and SOLID_QUEUE_IN_PUMA to be unset or false"
      end

      return
    end

    execution_paths = [ worker_provisioned?, queue_in_puma? ].count(true)
    if execution_paths.zero?
      raise ArgumentError,
        "ACTIVE_JOB_QUEUE_ADAPTER=solid_queue requires a dedicated worker or SOLID_QUEUE_IN_PUMA=true"
    end
    if execution_paths > 1
      raise ArgumentError, "Solid Queue must run in either a dedicated worker or Puma, not both"
    end
  end
end
