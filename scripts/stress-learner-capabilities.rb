# Run from api/: PARALLEL_WORKERS=1 bundle exec ruby ../scripts/stress-learner-capabilities.rb
# Optionally simulate a host wall-clock step after the expiry UPDATE. Installing
# this before Rails' time helpers lets a frozen test ignore the host adjustment.
clock_offset = 0.0
if ENV["STRESS_CLOCK_STEP"]
  wall_now = Time.method(:now)
  Time.define_singleton_method(:now) { wall_now.call + clock_offset }
end

$LOAD_PATH.unshift(File.expand_path("../api/test", __dir__))
require_relative "../api/test/integration/learner_capabilities_test"

klass = LearnerCapabilitiesTest
target = "test_self-paced_support_expiry_or_missing_assigned_instructor_never_advertises_course_questions"
original = klass.instance_method(target)
klass.public_instance_methods(false).grep(/^test_/).each { |name| klass.send(:remove_method, name) }
Integer(ENV.fetch("STRESS_REPEATS", "200")).times do |index|
  klass.define_method("test_expired_support_#{index}") { original.bind_call(self) }
end
if ENV["STRESS_SQL_DELAY"]
  ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
    sleep(Float(ENV.fetch("STRESS_SQL_DELAY"))) unless payload[:name] == "SCHEMA"
  end
end

if ENV["STRESS_CLOCK_STEP"]
  klass.prepend(Module.new do
    define_method(:before_setup) do
      clock_offset = 0.0
      super()
    end
  end)
  ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
    sql = payload[:sql]
    if sql.start_with?('UPDATE "enrollments"') && sql.include?('"first_opened_at"') && sql.include?('"support_expires_at"')
      clock_offset = Float(ENV.fetch("STRESS_CLOCK_STEP"))
    end
  end
end
