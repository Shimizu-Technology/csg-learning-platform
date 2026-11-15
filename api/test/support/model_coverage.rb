require "test_helper"

# Synthetic, local records shared by the domain tests; no fixtures or providers.
class ModelCoverageTestCase < ActiveSupport::TestCase
  setup { travel_to Time.utc(2026, 4, 5, 14, 5) } # Monday 00:05 ChST, Sunday UTC.
  teardown { travel_back }

  private

  def person(role = :student)
    @person_sequence = (@person_sequence || 0) + 1
    User.create!(clerk_id: "coverage_#{@person_sequence}", email: "coverage#{@person_sequence}@example.com", role: role)
  end

  def student
    @student ||= person
  end

  def staff
    @staff ||= person(:admin)
  end

  def curriculum
    @curriculum ||= Curriculum.create!(name: "Synthetic curriculum")
  end

  def course
    @course ||= Cohort.create!(curriculum: curriculum, name: "Synthetic cohort", start_date: Date.new(2026, 4, 6), status: :active)
  end

  def mod
    @mod ||= CurriculumModule.create!(curriculum: curriculum, name: "Foundations", position: 0)
  end

  def lesson
    @lesson ||= Lesson.create!(curriculum_module: mod, title: "Lesson", position: 0, release_day: 0)
  end

  def block
    @block ||= lesson.content_blocks.create!(block_type: :exercise, title: "Exercise", position: 0)
  end

  def enrollment
    @enrollment ||= Enrollment.create!(user: student, cohort: course)
  end

  def channel
    @channel ||= course.workspace.channels.first!
  end

  def sample_message
    @message ||= Message.create!(channel: channel, author: student, body: "Synthetic message")
  end

  def conversation
    @conversation ||= DirectConversation.find_or_create_for!(workspace: course.workspace, users: [ student, staff ])
  end

  def recording
    @recording ||= Recording.create!(cohort: course, title: "Recording", source_kind: "external", source_url: "https://example.com/video", position: 0)
  end

  def rubric
    @rubric ||= Rubric.create!(curriculum: curriculum, title: "Rubric", rubric_criteria_attributes: [ { title: "Correctness", description: "Works", position: 0 } ])
  end

  def submission
    @submission ||= Submission.create!(user: student, enrollment: enrollment, content_block: block)
  end

  def intervention
    @intervention ||= Intervention.create!(enrollment: enrollment, owner: staff, created_by: staff, trigger_type: :manual, next_follow_up_at: Time.current)
  end

  def plan
    @plan ||= RecoveryPlan.create!(enrollment: enrollment, owner: staff, created_by: staff, source: :manual,
      target_pace: "Weekly", required_scope: "Foundations", check_in_cadence: "Weekly", next_check_in_at: Time.current)
  end

  def meeting_config
    @meeting_config ||= PrivateMeetingConfig.create!(cohort: course, instructor: staff, timezone: "Pacific/Guam")
  end

  def slot
    @slot ||= meeting_config.private_meeting_slots.create!(instructor: staff, starts_at: 1.hour.from_now,
      ends_at: 1.hour.from_now + meeting_config.duration_minutes.minutes)
  end

  def booking
    @booking ||= PrivateMeetingBooking.create!(private_meeting_slot: slot, enrollment: enrollment, cohort: course,
      instructor: staff, student: student, week_number: 1, starts_at: slot.starts_at, ends_at: slot.ends_at)
  end

  # A PostgreSQL violation aborts its transaction. Keep it inside a savepoint so
  # subsequent assertions (and Rails' transactional teardown) remain usable.
  # Pass `constraint:` so the assertion proves which check, index, or exclusion
  # rejected the write rather than any constraint that happens to fire.
  def assert_database_rejects(record, attributes, error = ActiveRecord::CheckViolation, constraint: nil)
    original_id = record.id
    rejection = assert_raises(error) do
      record.class.transaction(requires_new: true) { record.update_columns(attributes) }
    end
    if constraint
      assert_equal constraint, rejection.cause.result.error_field(PG::Result::PG_DIAG_CONSTRAINT_NAME),
        "expected #{record.class} #{attributes.keys.inspect} to be rejected by #{constraint}"
    end
    record.id = original_id
    record.reload
  end

  def assert_invalid(record, attribute, value)
    record.public_send("#{attribute}=", value)
    assert_not record.valid?, "expected #{record.class}.#{attribute}=#{value.inspect} to be invalid"
    assert record.errors[attribute].any?, record.errors.full_messages.join(", ")
    record.reload if record.persisted?
  end
end
