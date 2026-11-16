class AddCourseMarketingAndOrientation < ActiveRecord::Migration[8.1]
  def change
    reversible { |dir| dir.up { execute "SET LOCAL lock_timeout = '5s'" } }
    add_column :cohorts, :public_slug, :string
    add_index :cohorts, :public_slug, unique: true
    add_column :cohorts, :public_outcomes, :text
    add_column :cohorts, :public_duration, :string
    add_column :cohorts, :public_prerequisites, :text
    add_column :cohorts, :public_preview, :text
    add_column :cohorts, :review_response_time, :string
    add_column :school_settings, :review_response_time, :string, default: "usually reviewed within 2 days", null: false
    add_column :enrollments, :start_here_dismissed_at, :datetime
    # ID-backed slugs disclose no internal labels and survive public title edits.
    reversible { |dir| dir.up { execute "UPDATE cohorts SET public_slug = 'course-' || id WHERE public_slug IS NULL" } }
  end
end
