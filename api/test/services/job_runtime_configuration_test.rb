require "test_helper"

class JobRuntimeConfigurationTest < ActiveSupport::TestCase
  test "defaults to inline execution without Solid Queue infrastructure" do
    configuration = JobRuntimeConfiguration.new({})

    assert_equal :inline, configuration.adapter
    assert_equal "inline", configuration.execution_path
  end

  test "accepts an explicit cost-optimized inline deployment" do
    configuration = JobRuntimeConfiguration.new(
      "ACTIVE_JOB_QUEUE_ADAPTER" => "inline",
      "SOLID_QUEUE_WORKER_PROVISIONED" => "false",
      "SOLID_QUEUE_IN_PUMA" => "false"
    )

    assert_equal :inline, configuration.adapter
    assert_equal "inline", configuration.execution_path
  end

  test "rejects Solid Queue flags in inline mode" do
    error = assert_raises(ArgumentError) do
      JobRuntimeConfiguration.new(
        "ACTIVE_JOB_QUEUE_ADAPTER" => "inline",
        "SOLID_QUEUE_WORKER_PROVISIONED" => "true"
      )
    end

    assert_match "Inline jobs require", error.message
  end

  test "accepts a dedicated Solid Queue worker" do
    configuration = JobRuntimeConfiguration.new(
      "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
      "SOLID_QUEUE_WORKER_PROVISIONED" => "true"
    )

    assert_equal :solid_queue, configuration.adapter
    assert_equal "dedicated_worker", configuration.execution_path
  end

  test "accepts Solid Queue inside Puma" do
    configuration = JobRuntimeConfiguration.new(
      "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
      "SOLID_QUEUE_IN_PUMA" => "true"
    )

    assert_equal :solid_queue, configuration.adapter
    assert_equal "puma", configuration.execution_path
  end

  test "rejects Solid Queue without an execution path" do
    error = assert_raises(ArgumentError) do
      JobRuntimeConfiguration.new("ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue")
    end

    assert_match "requires a dedicated worker", error.message
  end

  test "rejects duplicate Solid Queue execution paths" do
    error = assert_raises(ArgumentError) do
      JobRuntimeConfiguration.new(
        "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
        "SOLID_QUEUE_WORKER_PROVISIONED" => "true",
        "SOLID_QUEUE_IN_PUMA" => "true"
      )
    end

    assert_match "not both", error.message
  end

  test "rejects unsupported job adapters" do
    error = assert_raises(ArgumentError) do
      JobRuntimeConfiguration.new("ACTIVE_JOB_QUEUE_ADAPTER" => "async")
    end

    assert_match "must be one of", error.message
  end
end
