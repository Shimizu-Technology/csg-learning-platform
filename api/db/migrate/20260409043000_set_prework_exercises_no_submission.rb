class SetPreworkExercisesNoSubmission < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      UPDATE lessons
      SET requires_submission = false
      WHERE module_id IN (
        SELECT id FROM modules WHERE module_type = 0
      )
    SQL
  end

  def down
    execute <<~SQL
      UPDATE lessons
      SET requires_submission = true
      WHERE module_id IN (
        SELECT id FROM modules WHERE module_type = 0
      )
      AND id IN (
        SELECT DISTINCT lesson_id FROM content_blocks WHERE block_type = 2
      )
    SQL
  end
end
