class RecordContentAvailability < ActiveRecord::Migration[8.1]
  def change
    add_column :lesson_assignments, :availability_changed_at, :datetime
    add_column :recordings, :published_at, :datetime
    add_column :curriculum_resources, :ready_at, :datetime
    reversible do |dir|
      dir.up do
        execute "UPDATE lesson_assignments SET availability_changed_at = updated_at"
        execute "UPDATE recordings SET published_at = updated_at WHERE status = 1"
        execute "UPDATE curriculum_resources SET ready_at = updated_at WHERE ready = TRUE"
        execute <<~SQL
          UPDATE cohorts SET settings = jsonb_set(settings, '{class_resources}', (
            SELECT jsonb_agg(CASE WHEN resource ? 'available_at' THEN resource
              ELSE resource || jsonb_build_object('available_at', cohorts.updated_at AT TIME ZONE 'UTC') END)
            FROM jsonb_array_elements(settings->'class_resources') AS resource
          ))
          WHERE CASE WHEN jsonb_typeof(settings->'class_resources') = 'array'
            THEN jsonb_array_length(settings->'class_resources') > 0 ELSE FALSE END
        SQL
        execute <<~SQL
          UPDATE cohorts SET settings = jsonb_set(settings, '{recordings}', (
            SELECT jsonb_agg(CASE WHEN resource ? 'available_at' THEN resource
              ELSE resource || jsonb_build_object('available_at', cohorts.updated_at AT TIME ZONE 'UTC') END)
            FROM jsonb_array_elements(settings->'recordings') AS resource
          ))
          WHERE CASE WHEN jsonb_typeof(settings->'recordings') = 'array'
            THEN jsonb_array_length(settings->'recordings') > 0 ELSE FALSE END
        SQL
      end
    end
  end
end
