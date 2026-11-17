# Run from api/: PARALLEL_WORKERS=1 bundle exec ruby ../scripts/stress-learner-capabilities.rb
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
