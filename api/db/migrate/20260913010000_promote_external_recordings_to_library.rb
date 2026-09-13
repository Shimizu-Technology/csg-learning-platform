class PromoteExternalRecordingsToLibrary < ActiveRecord::Migration[8.1]
  def up
    add_column :recordings, :source_kind, :string, null: false, default: "uploaded"
    add_column :recordings, :source_url, :text
    add_column :recordings, :legacy_key, :string
    change_column_null :recordings, :s3_key, true
    change_column_null :recordings, :content_type, true
    change_column_null :recordings, :file_size, true
    add_index :recordings, [ :cohort_id, :legacy_key ], unique: true, where: "legacy_key IS NOT NULL"

    execute <<~SQL.squish
      INSERT INTO recordings
        (cohort_id, title, description, source_kind, source_url, legacy_key, status, position, recorded_date, created_at, updated_at)
      SELECT
        cohorts.id,
        COALESCE(NULLIF(entry.item ->> 'title', ''), 'Untitled recording'),
        NULLIF(entry.item ->> 'description', ''),
        CASE
          WHEN LOWER(entry.item ->> 'url') ~ '(^|//)([^/]*\\.)?(youtube\\.com|youtu\\.be)(/|$)' THEN 'youtube'
          WHEN LOWER(entry.item ->> 'url') ~ '(^|//)([^/]*\\.)?vimeo\\.com(/|$)' THEN 'vimeo'
          WHEN LOWER(entry.item ->> 'url') ~ '(^|//)([^/]*\\.)?loom\\.com(/|$)' THEN 'loom'
          WHEN LOWER(SPLIT_PART(entry.item ->> 'url', '?', 1)) ~ '\\.(m3u8|m4v|mov|mp4|webm)$' THEN 'direct'
          ELSE 'external'
        END,
        entry.item ->> 'url',
        'settings-' || entry.ordinality,
        1,
        COALESCE(existing.max_position, -1) + entry.ordinality,
        CASE
          WHEN entry.item ->> 'date' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (entry.item ->> 'date')::date
          ELSE NULL
        END,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM cohorts
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cohorts.settings -> 'recordings', '[]'::jsonb))
        WITH ORDINALITY AS entry(item, ordinality)
      LEFT JOIN LATERAL (
        SELECT MAX(recordings.position) AS max_position
        FROM recordings
        WHERE recordings.cohort_id = cohorts.id
      ) existing ON TRUE
      WHERE entry.item ->> 'url' ~* '^https://[^[:space:]]+$'
      ON CONFLICT (cohort_id, legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING
    SQL
  end

  def down
    execute <<~SQL.squish
      UPDATE cohorts
      SET settings = jsonb_set(
        COALESCE(cohorts.settings, '{}'::jsonb),
        '{recordings}',
        COALESCE(cohorts.settings -> 'recordings', '[]'::jsonb) || COALESCE((
          SELECT jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'title', recordings.title,
              'url', recordings.source_url,
              'date', TO_CHAR(recordings.recorded_date, 'YYYY-MM-DD'),
              'description', recordings.description
            )) ORDER BY recordings.position
          )
          FROM recordings
          WHERE recordings.cohort_id = cohorts.id
            AND recordings.source_kind <> 'uploaded'
            AND recordings.legacy_key IS NULL
        ), '[]'::jsonb),
        true
      )
      WHERE EXISTS (
        SELECT 1
        FROM recordings
        WHERE recordings.cohort_id = cohorts.id
          AND recordings.source_kind <> 'uploaded'
          AND recordings.legacy_key IS NULL
      )
    SQL
    execute "DELETE FROM recordings WHERE source_kind <> 'uploaded'"
    remove_index :recordings, [ :cohort_id, :legacy_key ]
    remove_column :recordings, :legacy_key
    remove_column :recordings, :source_url
    remove_column :recordings, :source_kind
    change_column_null :recordings, :s3_key, false
    change_column_null :recordings, :content_type, false
    change_column_null :recordings, :file_size, false
  end
end
