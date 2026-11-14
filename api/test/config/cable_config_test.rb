require "test_helper"

class CableConfigTest < ActiveSupport::TestCase
  def production_cable_config(env = {})
    original = env.keys.index_with { |key| ENV[key] }
    env.each { |key, value| ENV[key] = value }
    yaml = ERB.new(Rails.root.join("config/cable.yml").read).result
    YAML.safe_load(yaml, aliases: true).fetch("production")
  ensure
    original&.each { |key, value| ENV[key] = value }
  end

  test "production uses the in-memory adapter by default" do
    config = production_cable_config("CABLE_ADAPTER" => nil, "CABLE_URL" => nil)
    assert_equal "async", config["adapter"]
    assert_equal "csg_learning_platform_production", config["channel_prefix"]
    refute config.key?("url")
  end

  test "production adapter and url can be switched for multi-process deployments" do
    config = production_cable_config("CABLE_ADAPTER" => "redis", "CABLE_URL" => "redis://cable.example.test:6379/1")
    assert_equal "redis", config["adapter"]
    assert_equal "redis://cable.example.test:6379/1", config["url"]
  end

  test "a blank cable url is ignored" do
    config = production_cable_config("CABLE_ADAPTER" => nil, "CABLE_URL" => "  ")
    assert_equal "async", config["adapter"]
    refute config.key?("url")
  end

  test "async warns when more than one process can broadcast" do
    assert_nil ActionCableAdapterCheck.warning(adapter: "async", web_processes: 1, queue_adapter: :inline)
    assert_match "redis gem", ActionCableAdapterCheck.warning(adapter: "async", web_processes: 2, queue_adapter: :inline)
    assert_match "solid_queue", ActionCableAdapterCheck.warning(adapter: "async", web_processes: 1, queue_adapter: :solid_queue)
    assert_nil ActionCableAdapterCheck.warning(adapter: "redis", web_processes: 4, queue_adapter: :solid_queue)
  end

  test "auto web concurrency counts as more than one process" do
    original = ENV["WEB_CONCURRENCY"]
    ENV["WEB_CONCURRENCY"] = "auto"
    assert_operator ActionCableAdapterCheck.web_processes, :>, 1
    ENV["WEB_CONCURRENCY"] = "0"
    assert_equal 1, ActionCableAdapterCheck.web_processes
  ensure
    ENV["WEB_CONCURRENCY"] = original
  end
end
