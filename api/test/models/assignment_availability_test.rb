require "test_helper"

class AssignmentAvailabilityTest < ActiveSupport::TestCase
  setup do
    @curriculum = Curriculum.create!(name: "Availability history")
    @mod = @curriculum.modules.create!(name: "Past module", position: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "History", start_date: Date.new(2026, 11, 1))
    @student = User.create!(clerk_id: "availability_student", email: "availability@example.com", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    @lesson = @mod.lessons.create!(title: "Past lesson", position: 0, release_day: 0, created_at: Time.utc(2026, 11, 1))
  end

  [ :lesson, :module ].each do |kind|
    test "#{kind} keeps readable history when past date edits do not change effective availability" do
      travel_to Time.utc(2026, 11, 10) do
        @assignment = create_assignment(kind, unlock_date_override: Date.new(2026, 11, 1))
      end
      original = @assignment.availability_changed_at
      travel_to Time.utc(2026, 11, 12) do
        @enrollment.update!(status: :paused)
      end
      travel_to Time.utc(2026, 11, 15) do
        @assignment.update!(unlock_date_override: Date.new(2026, 11, 2))
        assert_equal original, @assignment.reload.availability_changed_at
        assert readable?(kind)
        @assignment.update!(unlocked: true)
        assert_equal original, @assignment.reload.availability_changed_at
        assert readable?(kind), "An irrelevant boolean edit must keep past access"
        @assignment.update!(unlock_date_override: nil)
        assert_equal original, @assignment.reload.availability_changed_at
        assert readable?(kind)
      end
    end

    test "#{kind} preserves a legacy null timestamp on an availability-neutral edit" do
      travel_to Time.utc(2026, 11, 10) do
        @assignment = create_assignment(kind, unlock_date_override: Date.new(2026, 11, 1))
        @assignment.update_column(:availability_changed_at, nil)
      end
      baseline = @assignment.reload.updated_at
      travel_to Time.utc(2026, 11, 12) do
        @enrollment.update!(status: :paused)
      end
      travel_to Time.utc(2026, 11, 15) do
        assert readable?(kind)
        @assignment.update!(unlock_date_override: Date.new(2026, 11, 2))
        assert_equal baseline, @assignment.reload.availability_changed_at
        assert readable?(kind)
      end
    end

    test "#{kind} cannot backdate currently open content across the pause cutoff" do
      travel_to Time.utc(2026, 11, 10) do
        @assignment = create_assignment(kind, unlock_date_override: Date.new(2026, 11, 13))
      end
      travel_to Time.utc(2026, 11, 12) do
        @enrollment.update!(status: :paused)
      end
      travel_to Time.utc(2026, 11, 15) do
        refute readable?(kind)
        @assignment.update!(unlock_date_override: Date.new(2026, 11, 1))
        assert_equal Time.current, @assignment.reload.availability_changed_at
        refute readable?(kind)
      end
    end

    test "#{kind} records an actual late unlock and prevents backdating around a pause" do
      travel_to Time.utc(2026, 11, 10) do
        @assignment = create_assignment(kind, unlocked: false, unlock_date_override: Date.new(2026, 12, 1))
      end
      travel_to Time.utc(2026, 11, 12) do
        @enrollment.update!(status: :paused)
      end
      travel_to Time.utc(2026, 11, 15) do
        @assignment.update!(unlock_date_override: Date.new(2026, 11, 1))
        assert_equal Time.current, @assignment.reload.availability_changed_at
        refute readable?(kind)
      end
    end

    test "#{kind} records a boolean unlock only when it makes content available" do
      @cohort.update!(start_date: Date.new(2026, 12, 1)) if kind == :module
      travel_to Time.utc(2026, 11, 10) do
        @assignment = create_assignment(kind, unlocked: false)
      end
      original = @assignment.availability_changed_at
      travel_to Time.utc(2026, 11, 12) do
        @enrollment.update!(status: :paused)
      end
      travel_to Time.utc(2026, 11, 15) do
        @assignment.update!(unlocked: true)
        assert_operator @assignment.availability_changed_at, :>, original
        assert_equal Time.current, @assignment.reload.availability_changed_at
        refute readable?(kind)
        @assignment.update!(unlocked: false)
        refute readable?(kind)
      end
    end
  end

  test "moving an open module date later keeps lessons that remain available readable" do
    later = @mod.lessons.create!(title: "Later lesson", position: 1, release_day: 10, created_at: Time.utc(2026, 11, 1))
    travel_to Time.utc(2026, 11, 10) do
      @assignment = create_assignment(:module, unlock_date_override: Date.new(2026, 11, 1))
    end
    original = @assignment.availability_changed_at
    travel_to Time.utc(2026, 11, 12) do
      @enrollment.update!(status: :paused)
    end
    travel_to Time.utc(2026, 11, 15) do
      assert later.available?(@cohort, @assignment)
      @assignment.update!(unlock_date_override: Date.new(2026, 11, 10))
      refute later.available?(@cohort, @assignment)
      assert_equal original, @assignment.reload.availability_changed_at
      assert readable?(:module)
    end
  end

  test "moving an open module date records newly released later lessons" do
    later = @mod.lessons.create!(title: "Later lesson", position: 1, release_day: 10, created_at: Time.utc(2026, 11, 1))
    travel_to Time.utc(2026, 11, 10) do
      @assignment = create_assignment(:module, unlock_date_override: Date.new(2026, 11, 10))
      @enrollment.update!(status: :paused)
    end
    travel_to Time.utc(2026, 11, 15) do
      assert @assignment.accessible?
      refute later.available?(@cohort, @assignment)
      @assignment.update!(unlock_date_override: Date.new(2026, 11, 1))
      assert later.available?(@cohort, @assignment)
      assert_equal Time.current, @assignment.reload.availability_changed_at
      refute @enrollment.lesson_available_for_read?(later, @assignment, nil)
    end
  end

  private

  def create_assignment(kind, **attributes)
    if kind == :lesson
      @enrollment.lesson_assignments.create!(lesson: @lesson, **attributes)
    else
      @enrollment.module_assignments.create!(curriculum_module: @mod, **attributes)
    end
  end

  def readable?(kind)
    @enrollment.lesson_available_for_read?(@lesson, kind == :module ? @assignment : nil, kind == :lesson ? @assignment : nil)
  end
end
