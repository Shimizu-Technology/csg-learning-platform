# The redesigned student experience (`student_experience_v2`) defaults on, so
# new cohorts and self-paced courses get it. Learners already part-way through
# a course keep today's views until an admin turns it on for their cohort:
# every cohort that has started and has an active enrollment gets an Off
# override. In production that is Cohort 3 (Lance, finishing Dec 19); the rule
# reads the data at run time rather than naming a cohort, so any other running
# cohort is kept on the current experience too.
#
# Each override is audited as a system change (a FeatureSwitchChange with no
# actor), so School settings history shows where it came from. An existing
# override is never replaced. Plain UPDATE/INSERT statements in the migration's
# transaction: no session locks or SET, which transaction-mode PgBouncer can't
# carry. Down removes only the overrides this migration wrote.
class KeepRunningCohortsOnCurrentStudentExperience < ActiveRecord::Migration[8.1]
  KEY = "student_experience_v2".freeze
  SOURCE = "20261118020000_keep_running_cohorts_on_current_student_experience".freeze
  ACTIVE_ENROLLMENT = 0

  def up
    change_column_null :feature_switch_changes, :actor_id, true
    today = LearningCalendar.today
    rows = select_rows(<<~SQL)
      UPDATE cohorts
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{features}',
        CASE WHEN jsonb_typeof(settings->'features') = 'object' THEN settings->'features' ELSE '{}'::jsonb END
          || jsonb_build_object('#{KEY}', false)),
        updated_at = NOW()
      WHERE start_date <= #{quote(today)}
        AND NOT COALESCE(jsonb_typeof(settings->'features') = 'object' AND settings->'features' ? '#{KEY}', FALSE)
        AND EXISTS (SELECT 1 FROM enrollments WHERE enrollments.cohort_id = cohorts.id AND enrollments.status = #{ACTIVE_ENROLLMENT})
      RETURNING id, name
    SQL
    rows.each do |id, name|
      execute <<~SQL
        INSERT INTO feature_switch_changes (actor_id, cohort_id, before, after, created_at, updated_at)
        VALUES (NULL, #{quote(id)}, #{quote({ source: SOURCE, overrides: {} }.to_json)}::jsonb,
          #{quote({ source: SOURCE, cohort: { id: id, name: name }, overrides: { KEY => false } }.to_json)}::jsonb, NOW(), NOW())
      SQL
    end
    say "Kept #{rows.size} running #{rows.size == 1 ? 'cohort' : 'cohorts'} on the current student experience: #{rows.map(&:last).join(', ').presence || 'none'}"
  end

  def down
    execute <<~SQL
      UPDATE cohorts SET settings = jsonb_set(settings, '{features}', (settings->'features') - '#{KEY}'), updated_at = NOW()
      WHERE id IN (SELECT cohort_id FROM feature_switch_changes WHERE actor_id IS NULL AND after->>'source' = #{quote(SOURCE)})
        AND jsonb_typeof(settings->'features') = 'object' AND settings->'features'->'#{KEY}' = 'false'::jsonb
    SQL
    execute "DELETE FROM feature_switch_changes WHERE actor_id IS NULL AND after->>'source' = #{quote(SOURCE)}"
    change_column_null :feature_switch_changes, :actor_id, false
  end
end
