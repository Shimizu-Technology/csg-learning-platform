class CreateAnnouncements < ActiveRecord::Migration[8.1]
  def change
    create_table :announcements do |t|
      t.string :title, null: false
      t.text :body, null: false
      t.references :cohort, null: true, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.integer :audience, null: false, default: 0
      t.integer :status, null: false, default: 1
      t.boolean :pinned, null: false, default: false
      t.datetime :published_at
      t.datetime :archived_at

      t.timestamps
    end

    add_index :announcements, [ :status, :published_at ]
    add_index :announcements, [ :audience, :cohort_id ]

    reversible do |dir|
      dir.up do
        execute <<~SQL.squish
          INSERT INTO announcements
            (title, body, cohort_id, author_id, audience, status, pinned, published_at, created_at, updated_at)
          SELECT
            COALESCE(NULLIF(announcement->>'title', ''), 'Announcement'),
            COALESCE(announcement->>'body', ''),
            cohorts.id,
            users.id,
            0,
            1,
            COALESCE((announcement->>'pinned')::boolean, false),
            COALESCE(NULLIF(announcement->>'published_at', '')::timestamp, CURRENT_TIMESTAMP),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          FROM cohorts
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cohorts.settings->'announcements', '[]'::jsonb)) AS announcement
          CROSS JOIN LATERAL (
            SELECT id FROM users WHERE role IN (1, 2) ORDER BY role DESC, id ASC LIMIT 1
          ) users
          WHERE COALESCE(announcement->>'title', announcement->>'body', '') <> ''
        SQL
      end
    end
  end
end
