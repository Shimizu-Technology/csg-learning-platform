class AddContentDefaultsToCohorts < ActiveRecord::Migration[8.1]
  def up
    add_column :cohorts, :content_defaults, :jsonb
    backfill_content_defaults
  end

  def down
    remove_column :cohorts, :content_defaults
  end

  def backfill_content_defaults
    # Keep learner assignments/evidence intact. Preserve the existing selection
    # where schedules or active assignments exist; otherwise retain legacy all.
    # Only unanimous overrides become defaults; individual exceptions stay local.
    execute <<~SQL
      UPDATE cohorts c SET content_defaults = COALESCE((
        SELECT jsonb_object_agg(m.id::text, jsonb_build_object(
          'assigned', NOT EXISTS (
            SELECT 1 FROM cohort_module_schedules s WHERE s.cohort_id = c.id
            UNION ALL
            SELECT 1 FROM module_assignments a JOIN enrollments e ON e.id = a.enrollment_id
            WHERE e.cohort_id = c.id AND e.status = 0
              AND (e.access_expires_at IS NULL OR e.access_expires_at > CURRENT_TIMESTAMP)
          ) OR EXISTS (
            SELECT 1 FROM cohort_module_schedules s WHERE s.cohort_id = c.id AND s.module_id = m.id
            UNION ALL
            SELECT 1 FROM module_assignments a JOIN enrollments e ON e.id = a.enrollment_id
            WHERE e.cohort_id = c.id AND e.status = 0 AND a.module_id = m.id
              AND (e.access_expires_at IS NULL OR e.access_expires_at > CURRENT_TIMESTAMP)
          ),
          'unlocked', COALESCE(overrides.unlocked, false),
          'unlock_date_override', overrides.unlock_date_override
        )) FROM modules m
        LEFT JOIN LATERAL (
          SELECT bool_and(a.unlocked) AS unlocked,
            CASE WHEN count(a.unlock_date_override) = count(*)
              AND min(a.unlock_date_override) = max(a.unlock_date_override)
              THEN min(a.unlock_date_override) END AS unlock_date_override
          FROM module_assignments a JOIN enrollments e ON e.id = a.enrollment_id
          WHERE e.cohort_id = c.id AND e.status = 0 AND a.module_id = m.id
            AND (e.access_expires_at IS NULL OR e.access_expires_at > CURRENT_TIMESTAMP)
        ) overrides ON true
        WHERE m.curriculum_id = c.curriculum_id
      ), '{}'::jsonb)
    SQL
  end
end
