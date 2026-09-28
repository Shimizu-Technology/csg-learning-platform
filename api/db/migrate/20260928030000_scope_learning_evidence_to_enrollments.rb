class ScopeLearningEvidenceToEnrollments < ActiveRecord::Migration[8.1]
  def up
    add_reference :progresses, :enrollment, foreign_key: true
    add_reference :submissions, :enrollment, foreign_key: true

    # Older evidence has no recorded cohort. Attach it to the most recent
    # enrollment that existed when the evidence was made. Keep orphaned imports
    # nullable instead of assigning them to an unrelated class.
    %w[progresses submissions].each do |table|
      execute <<~SQL
        UPDATE #{table} AS evidence
        SET enrollment_id = (
          SELECT enrollments.id
          FROM enrollments
          JOIN cohorts ON cohorts.id = enrollments.cohort_id
          JOIN modules ON modules.curriculum_id = cohorts.curriculum_id
          JOIN lessons ON lessons.module_id = modules.id
          JOIN content_blocks ON content_blocks.lesson_id = lessons.id
          WHERE enrollments.user_id = evidence.user_id
            AND content_blocks.id = evidence.content_block_id
            AND (enrollments.enrolled_at IS NULL OR enrollments.enrolled_at <= evidence.created_at)
          ORDER BY enrollments.enrolled_at DESC NULLS LAST, enrollments.id DESC
          LIMIT 1
        )
      SQL
      execute <<~SQL
        UPDATE #{table} AS evidence
        SET enrollment_id = (
          SELECT enrollments.id
          FROM enrollments
          JOIN cohorts ON cohorts.id = enrollments.cohort_id
          JOIN modules ON modules.curriculum_id = cohorts.curriculum_id
          JOIN lessons ON lessons.module_id = modules.id
          JOIN content_blocks ON content_blocks.lesson_id = lessons.id
          WHERE enrollments.user_id = evidence.user_id
            AND content_blocks.id = evidence.content_block_id
          ORDER BY enrollments.enrolled_at ASC NULLS LAST, enrollments.id ASC
          LIMIT 1
        )
        WHERE evidence.enrollment_id IS NULL
      SQL
    end

    remove_index :progresses, name: "index_progresses_on_user_id_and_content_block_id"
    add_index :progresses, [ :enrollment_id, :content_block_id ], unique: true,
      name: "idx_progresses_enrollment_block", where: "enrollment_id IS NOT NULL"
    add_index :progresses, [ :user_id, :content_block_id ], unique: true,
      name: "idx_progresses_legacy_user_block", where: "enrollment_id IS NULL"
    add_index :submissions, [ :enrollment_id, :content_block_id, :created_at ],
      name: "idx_submissions_enrollment_block_created"
  end

  def down
    # A student may have one progress row per enrollment after this migration.
    # Refuse a rollback that would have to discard learning evidence.
    duplicates = select_value(<<~SQL)
      SELECT 1 FROM progresses GROUP BY user_id, content_block_id HAVING COUNT(*) > 1 LIMIT 1
    SQL
    raise ActiveRecord::IrreversibleMigration, "Repeated-cohort progress exists" if duplicates

    remove_index :progresses, name: "idx_progresses_enrollment_block"
    remove_index :progresses, name: "idx_progresses_legacy_user_block"
    remove_index :submissions, name: "idx_submissions_enrollment_block_created"
    remove_reference :progresses, :enrollment, foreign_key: true
    remove_reference :submissions, :enrollment, foreign_key: true
    add_index :progresses, [ :user_id, :content_block_id ], unique: true,
      name: "index_progresses_on_user_id_and_content_block_id"
  end
end
