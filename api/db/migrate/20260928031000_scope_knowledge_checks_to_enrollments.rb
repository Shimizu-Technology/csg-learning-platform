class ScopeKnowledgeChecksToEnrollments < ActiveRecord::Migration[8.1]
  def up
    add_reference :knowledge_check_attempts, :enrollment, foreign_key: true
    execute <<~SQL
      UPDATE knowledge_check_attempts AS evidence
      SET enrollment_id = (
        SELECT enrollments.id
        FROM enrollments
        JOIN cohorts ON cohorts.id = enrollments.cohort_id
        JOIN modules ON modules.curriculum_id = cohorts.curriculum_id
        JOIN lessons ON lessons.module_id = modules.id
        JOIN content_blocks ON content_blocks.lesson_id = lessons.id
        JOIN knowledge_checks ON knowledge_checks.content_block_id = content_blocks.id
        WHERE enrollments.user_id = evidence.user_id
          AND knowledge_checks.id = evidence.knowledge_check_id
          AND (enrollments.enrolled_at IS NULL OR enrollments.enrolled_at <= evidence.created_at)
        ORDER BY enrollments.enrolled_at DESC NULLS LAST, enrollments.id DESC
        LIMIT 1
      )
    SQL
    execute <<~SQL
      UPDATE knowledge_check_attempts AS evidence
      SET enrollment_id = (
        SELECT enrollments.id
        FROM enrollments
        JOIN cohorts ON cohorts.id = enrollments.cohort_id
        JOIN modules ON modules.curriculum_id = cohorts.curriculum_id
        JOIN lessons ON lessons.module_id = modules.id
        JOIN content_blocks ON content_blocks.lesson_id = lessons.id
        JOIN knowledge_checks ON knowledge_checks.content_block_id = content_blocks.id
        WHERE enrollments.user_id = evidence.user_id
          AND knowledge_checks.id = evidence.knowledge_check_id
        ORDER BY enrollments.enrolled_at ASC NULLS LAST, enrollments.id ASC
        LIMIT 1
      )
      WHERE evidence.enrollment_id IS NULL
    SQL
  end

  def down
    remove_reference :knowledge_check_attempts, :enrollment, foreign_key: true
  end
end
