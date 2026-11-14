class RecordContentAvailability < ActiveRecord::Migration[8.1]
  def change
    add_column :module_assignments, :availability_changed_at, :datetime
    add_column :lesson_assignments, :availability_changed_at, :datetime
    add_column :recordings, :published_at, :datetime
    add_column :curriculum_resources, :ready_at, :datetime
    reversible do |dir|
      dir.up do
        %w[module_assignments lesson_assignments].each do |table|
          execute <<~SQL
            UPDATE #{table} SET availability_changed_at = updated_at
            WHERE enrollment_id IN (SELECT id FROM enrollments WHERE status = 1)
              AND availability_changed_at IS NULL
          SQL
        end
        execute "UPDATE recordings SET published_at = updated_at WHERE status = 1"
        execute "UPDATE curriculum_resources SET ready_at = updated_at WHERE ready = TRUE"
        execute <<~SQL
          UPDATE cohorts SET settings = jsonb_set(settings, '{class_resources}', (
            SELECT jsonb_agg(CASE WHEN resource ? 'available_at' THEN resource
              ELSE resource || jsonb_build_object('available_at', cohorts.updated_at AT TIME ZONE 'UTC') END ORDER BY ordinality)
            FROM jsonb_array_elements(settings->'class_resources') WITH ORDINALITY AS items(resource, ordinality)
          ))
          WHERE CASE WHEN jsonb_typeof(settings->'class_resources') = 'array'
            THEN jsonb_array_length(settings->'class_resources') > 0 ELSE FALSE END
        SQL
        execute <<~SQL
          UPDATE cohorts SET settings = jsonb_set(settings, '{recordings}', (
            SELECT jsonb_agg(CASE WHEN resource ? 'available_at' THEN resource
              ELSE resource || jsonb_build_object('available_at', cohorts.updated_at AT TIME ZONE 'UTC') END ORDER BY ordinality)
            FROM jsonb_array_elements(settings->'recordings') WITH ORDINALITY AS items(resource, ordinality)
          ))
          WHERE CASE WHEN jsonb_typeof(settings->'recordings') = 'array'
            THEN jsonb_array_length(settings->'recordings') > 0 ELSE FALSE END
        SQL
      end
    end
  end
end
