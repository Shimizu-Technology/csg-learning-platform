require "test_helper"
require Rails.root.join("db/migrate/20261003020000_repair_focused_recording_instruction_markup")

class RepairFocusedRecordingInstructionMarkupTest < ActiveSupport::TestCase
  RANGE = "4:07–1:16:53"

  test "repairs malformed imported HTML from the preserved original body" do
    lesson = create_lesson
    original = "<p><strong>Watch:</strong> Use 4:07–1:16:53 from the attached recording.</p> <p>Keep this explanation.</p>"
    malformed = "**Watch:** Use the reviewed recording sections above. Each selection skips unrelated class time and pauses at its stop time. </p> <p>Keep this explanation.</p>"
    block = create_instruction(lesson, original, malformed)
    migration = migration_for(lesson)

    migration.migrate(:up)

    assert_equal "<p><strong>Watch:</strong> Use the reviewed recording sections above. Each selection skips unrelated class time and pauses at its stop time.</p> <p>Keep this explanation.</p>", block.reload.body
    assert block.metadata.key?(RepairFocusedRecordingInstructionMarkup::OWNERSHIP_KEY)

    migration.migrate(:down)

    assert_equal malformed, block.reload.body
    refute block.metadata.key?(RepairFocusedRecordingInstructionMarkup::OWNERSHIP_KEY)
  end

  test "preserves staff edits made before repair or before rollback" do
    lesson = create_lesson
    original = "**Watch:** Use #{RANGE} from the attached recording. Keep this explanation.\n"
    malformed = "**Watch:** Use the reviewed recording sections above. </p>\n"
    skipped = create_instruction(lesson, original, "Staff edited before repair.\n", installed_body: malformed)
    repaired = create_instruction(lesson, original, malformed, position: 1)
    migration = migration_for(lesson)

    migration.migrate(:up)
    repaired.update_columns(body: "Staff edited after repair.\n")
    migration.migrate(:down)

    assert_equal "Staff edited before repair.\n", skipped.reload.body
    assert_equal "Staff edited after repair.\n", repaired.reload.body
    refute repaired.metadata.key?(RepairFocusedRecordingInstructionMarkup::OWNERSHIP_KEY)
  end

  private

  def create_lesson
    curriculum = Curriculum.create!(name: "Instruction repair curriculum")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Recordings", position: 0, day_offset: 0, schedule_days: "weekdays")
    Lesson.create!(curriculum_module: curriculum_module, title: "Recording", position: 0, release_day: 0)
  end

  def create_instruction(lesson, original, current, installed_body: current, position: 0)
    ContentBlock.create!(
      lesson: lesson,
      block_type: :exercise,
      position: position,
      title: "Practice",
      body: current,
      metadata: {
        "notes" => "keep",
        RepairFocusedRecordingInstructionMarkup::PREVIOUS_OWNERSHIP_KEY => {
          "body" => original,
          "installed_body" => installed_body
        }
      }
    )
  end

  def migration_for(lesson)
    RepairFocusedRecordingInstructionMarkup.new.tap do |migration|
      migration.define_singleton_method(:instruction_ranges) { { lesson.id => RANGE } }
    end
  end
end
