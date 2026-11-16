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
  test "daily unlocks never email a lesson the learner can't open, and skip a learner with none" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("notifications:send_daily_unlocks")
    task = Rake::Task["notifications:send_daily_unlocks"]
    curriculum = Curriculum.create!(name: "Rake unlock")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Released today", position: 0, release_day: 0)
    cohort = Cohort.create!(curriculum: curriculum, name: "Rake unlock", start_date: LearningCalendar.today, status: :active)
    open_learner, locked_learner = %w[open locked].map do |name|
      user = User.create!(clerk_id: "rake_unlock_#{name}", email: "rake-unlock-#{name}@example.test", first_name: name, role: :student)
      enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago)
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: mod, unlocked: true)
      user
    end
    # The module is open to both, but this lesson is locked for one learner on its own.
    LessonAssignment.create!(enrollment: locked_learner.enrollments.first, lesson: lesson, unlocked: false)
    originals = ENV.to_h.slice("RESEND_API_KEY", "RESEND_FROM_EMAIL")
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"
    original_send = Resend::Emails.method(:send)
    sent = []
    Resend::Emails.define_singleton_method(:send) { |params, options: {}| sent << params; { id: "unlock" } }

    output, = capture_io { task.reenable; task.invoke }

    recipients = sent.map { |params| params[:to] }
    assert_includes recipients, open_learner.email
    assert_not_includes recipients, locked_learner.email
    assert_match(/0 errors/, output)
  ensure
    Resend::Emails.define_singleton_method(:send, original_send) if original_send
    %w[RESEND_API_KEY RESEND_FROM_EMAIL].each { |key| ENV[key] = originals&.[](key) }
  end
end
