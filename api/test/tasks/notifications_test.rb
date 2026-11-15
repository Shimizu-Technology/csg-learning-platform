require "test_helper"
require "rake"

class NotificationsTaskTest < ActiveSupport::TestCase
  class Rows < Array
    def active = self
    def includes(*) = self
    def find_each(&block) = each(&block)
  end

  test "daily unlocks use the school date when UTC is still yesterday" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("notifications:send_daily_unlocks")
    task = Rake::Task["notifications:send_daily_unlocks"]
    travel_to Time.utc(2026, 4, 5, 16) do
      today = LearningCalendar.today
      assert_not_equal Date.current, today
      lesson = Object.new
      lesson.define_singleton_method(:unlock_date) { |*| today }
      mod = Struct.new(:lessons).new([ lesson ])
      assignment = Struct.new(:curriculum_module) do
        def accessible? = true
      end.new(mod)
      enrollment = Struct.new(:user, :module_assignments).new(:student, [ assignment ])
      cohort = Struct.new(:enrollments).new(Rows.new([ enrollment ]))
      active = Cohort.method(:active)
      configured = NotificationEmailService.method(:configured?)
      deliver = NotificationEmailService.method(:send_daily_unlock)
      deliveries = []
      Cohort.define_singleton_method(:active) { Rows.new([ cohort ]) }
      NotificationEmailService.define_singleton_method(:configured?) { true }
      NotificationEmailService.define_singleton_method(:send_daily_unlock) do |**args|
        deliveries << args
        true
      end
      capture_io { task.reenable; task.invoke }
      assert_equal [ lesson ], deliveries.fetch(0).fetch(:lessons)
    ensure
      Cohort.define_singleton_method(:active, active) if active
      NotificationEmailService.define_singleton_method(:configured?, configured) if configured
      NotificationEmailService.define_singleton_method(:send_daily_unlock, deliver) if deliver
    end
  end
end
