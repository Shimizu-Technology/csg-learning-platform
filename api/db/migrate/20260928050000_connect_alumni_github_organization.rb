class ConnectAlumniGithubOrganization < ActiveRecord::Migration[8.1]
  ALUMNI_ORGANIZATION = "Code-School-of-Guam-Alumni".freeze

  def up
    execute <<~SQL
      UPDATE cohorts
      SET github_organization_name = '#{ALUMNI_ORGANIZATION}'
      WHERE cohort_type = 2
        AND (github_organization_name IS NULL OR TRIM(github_organization_name) = '')
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Cannot distinguish backfilled alumni settings from later edits"
  end
end
