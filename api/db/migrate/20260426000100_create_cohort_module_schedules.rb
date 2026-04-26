class CreateCohortModuleSchedules < ActiveRecord::Migration[8.1]
  class MigrationCohort < ApplicationRecord
    self.table_name = "cohorts"
  end

  class MigrationCurriculumModule < ApplicationRecord
    self.table_name = "modules"
  end

  class MigrationCohortModuleSchedule < ApplicationRecord
    self.table_name = "cohort_module_schedules"
  end

  class MigrationModuleAssignment < ApplicationRecord
    self.table_name = "module_assignments"
  end

  def up
    create_table :cohort_module_schedules do |t|
      t.references :cohort, null: false, foreign_key: true
      t.bigint :module_id, null: false
      t.date :start_date, null: false

      t.timestamps
    end

    add_foreign_key :cohort_module_schedules, :modules, column: :module_id
    add_index :cohort_module_schedules, [ :cohort_id, :module_id ], unique: true

    say_with_time "Backfilling cohort module schedules from cohort start dates and module offsets" do
      MigrationCohort.find_each do |cohort|
        MigrationCurriculumModule.where(curriculum_id: cohort.curriculum_id).find_each do |curriculum_module|
          assignment_scope = MigrationModuleAssignment
            .joins("INNER JOIN enrollments ON enrollments.id = module_assignments.enrollment_id")
            .where(
              enrollments: { cohort_id: cohort.id },
              module_id: curriculum_module.id
            )
          shared_override_dates = assignment_scope.where.not(unlock_date_override: nil).distinct.pluck(:unlock_date_override)
          start_date = if shared_override_dates.one?
            shared_override_dates.first
          else
            legacy_start_date_for(cohort.start_date, curriculum_module)
          end

          MigrationCohortModuleSchedule.create!(
            cohort_id: cohort.id,
            module_id: curriculum_module.id,
            start_date: start_date
          )

          next unless shared_override_dates.one?

          assignment_scope.where(unlock_date_override: start_date).update_all(unlock_date_override: nil)
        end
      end
    end
  end

  def down
    remove_index :cohort_module_schedules, [ :cohort_id, :module_id ]
    remove_foreign_key :cohort_module_schedules, column: :module_id
    drop_table :cohort_module_schedules
  end

  private

  def legacy_start_date_for(cohort_start_date, curriculum_module)
    cohort_start_date + curriculum_module.day_offset + first_scheduled_day_index(curriculum_module.schedule_days)
  end

  def first_scheduled_day_index(schedule_days)
    case schedule_days
    when "tth"
      1
    else
      0
    end
  end
end
