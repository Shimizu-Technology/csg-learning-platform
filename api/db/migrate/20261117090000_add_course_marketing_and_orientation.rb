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
    reversible { |dir| dir.up { backfill_public_slugs } }
  end

  private

  # Keep the migration self-contained: future model changes must not change it.
  def backfill_public_slugs
    reserved = %w[new edit checkout return canceled success status]
    select_all("SELECT id, public_title FROM cohorts WHERE public_slug IS NULL ORDER BY id").each do |row|
      next if row["public_title"].blank?

      base = row["public_title"].to_s.parameterize.tr("_", "-").squeeze("-").delete_prefix("-").delete_suffix("-")
      base = "course-#{row['id']}" if base.blank? || reserved.include?(base)
      candidate = base
      suffix = 1
      while select_value("SELECT 1 FROM cohorts WHERE public_slug = #{connection.quote(candidate)} LIMIT 1")
        suffix += 1
        candidate = "#{base}-#{suffix}"
      end
      execute "UPDATE cohorts SET public_slug = #{connection.quote(candidate)} WHERE id = #{connection.quote(row['id'])}"
    end
  end
end
