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
end
