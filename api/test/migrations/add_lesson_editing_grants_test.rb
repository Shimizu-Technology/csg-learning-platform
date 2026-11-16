require "test_helper"
require Rails.root.join("db/migrate/20261116120000_add_lesson_editing_grants_to_cohort_instructor_assignments").to_s

class AddLessonEditingGrantsTest < ActiveSupport::TestCase
  test "adds the grant columns and a validated foreign key, reruns safely and rolls back" do
    migration = AddLessonEditingGrantsToCohortInstructorAssignments.new
    connection = CohortInstructorAssignment.connection
    table = :cohort_instructor_assignments
    2.times do
      migration.migrate(:down)
      refute connection.column_exists?(table, :can_edit_lessons)
      refute connection.foreign_key_exists?(table, name: "fk_cohort_instructor_assignments_edit_granted_by")
      migration.migrate(:up)
      migration.migrate(:up)
      connection.schema_cache.clear!
      columns = connection.columns(table).index_by(&:name)
      assert_equal [ :boolean, "false", false ], [ columns.fetch("can_edit_lessons").type, columns.fetch("can_edit_lessons").default, columns.fetch("can_edit_lessons").null ]
      assert columns.fetch("edit_granted_by_id").null
      assert columns.fetch("edit_granted_at").null
      key = connection.foreign_keys(table).find { |candidate| candidate.name == "fk_cohort_instructor_assignments_edit_granted_by" }
      assert_equal [ "users", :nullify ], [ key.to_table, key.on_delete ]
      assert connection.select_value("SELECT convalidated FROM pg_constraint WHERE conname = 'fk_cohort_instructor_assignments_edit_granted_by'")
    end
  ensure
    CohortInstructorAssignment.reset_column_information
  end
end
