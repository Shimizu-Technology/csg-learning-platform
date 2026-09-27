class PrepareAlumniCohortsForLaunch < ActiveRecord::Migration[8.1]
  class MigrationCohort < ApplicationRecord
    self.table_name = "cohorts"
  end

  class MigrationWorkspace < ApplicationRecord
    self.table_name = "workspaces"
  end

  class MigrationChannel < ApplicationRecord
    self.table_name = "channels"
  end

  ALUMNI_RESOURCES = [
    {
      "title" => "Start Here: Alumni Learning Library",
      "url" => "https://learn.codeschoolofguam.com/lessons/238",
      "category" => "start here",
      "description" => "Begin with the library orientation and learn how to use the recordings, examples, and optional practice."
    },
    {
      "title" => "CSG Alumni Resources",
      "url" => "https://github.com/Code-School-of-Guam-Alumni/Resources",
      "category" => "guides",
      "description" => "Private, current setup and curriculum guides for Code School of Guam alumni."
    },
    {
      "title" => "Find the Right Guide",
      "url" => "https://github.com/Code-School-of-Guam-Alumni/Resources/blob/main/FIND_A_GUIDE.md",
      "category" => "guides",
      "description" => "Use this index to jump directly to the setup, framework, deployment, portfolio, or AI guide you need."
    },
    {
      "title" => "Learning Examples",
      "url" => "https://github.com/Code-School-of-Guam-Alumni/Learning-Examples",
      "category" => "reference code",
      "description" => "Public runnable examples and lesson-specific reference code matched to CSG recordings."
    },
    {
      "title" => "Cohort 2 Recording Archive",
      "url" => "https://www.youtube.com/playlist?list=PLRpfxQ4ZG69WvQfcv9I-F5LtsQ3nwfj-f",
      "category" => "recordings",
      "description" => "The complete 79-recording classroom archive used by the Alumni Learning Library."
    },
    {
      "title" => "CSG Alumni GitHub Organization",
      "url" => "https://github.com/Code-School-of-Guam-Alumni",
      "category" => "community",
      "description" => "The shared home for alumni guides, learning examples, and collaborative projects."
    },
    {
      "title" => "Party Games Hub",
      "url" => "https://github.com/Code-School-of-Guam-Alumni/party-games-hub",
      "category" => "optional project",
      "description" => "An optional alumni collaboration project for practicing Rails, React, and product development."
    }
  ].freeze

  def up
    backfill_missing_workspaces
    prepare_alumni_workspaces
    merge_alumni_resources
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Alumni workspace and resource preparation preserves production data"
  end

  private

  def backfill_missing_workspaces
    MigrationCohort.find_each do |cohort|
      next if MigrationWorkspace.exists?(cohort_id: cohort.id)

      workspace = MigrationWorkspace.create!(
        cohort_id: cohort.id,
        name: cohort.name,
        slug: unique_slug_for(cohort),
        workspace_type: 0,
        status: archived_cohort?(cohort) ? 1 : 0,
        description: "Workspace for #{cohort.name}",
        created_at: Time.current,
        updated_at: Time.current
      )
      create_default_channel!(workspace, cohort)
    end
  end

  def prepare_alumni_workspaces
    alumni_cohorts.find_each do |cohort|
      workspace = MigrationWorkspace.find_by!(cohort_id: cohort.id)
      alumni_channel = MigrationChannel.find_by(workspace_id: workspace.id, name: "Alumni Chat", status: 0)
      archived_alumni_channel = MigrationChannel.find_by(workspace_id: workspace.id, name: "Alumni Chat", status: 1)
      legacy_channels = MigrationChannel.where(
        workspace_id: workspace.id,
        name: [ "Class Chat", "General" ],
        status: 0
      ).order(:name).to_a

      if alumni_channel
        legacy_channels.each { |channel| archive_legacy_channel!(channel) }
      elsif legacy_channels.any?
        archive_legacy_channel!(archived_alumni_channel) if archived_alumni_channel
        primary_channel = legacy_channels.first
        primary_channel.update!(
          name: "Alumni Chat",
          description: "Ongoing discussion and support for Code School of Guam alumni."
        )
        legacy_channels.drop(1).each { |channel| archive_legacy_channel!(channel) }
      else
        archive_legacy_channel!(archived_alumni_channel) if archived_alumni_channel
        create_default_channel!(workspace, cohort)
      end
    end
  end

  def merge_alumni_resources
    alumni_cohorts.find_each do |cohort|
      settings = (cohort.settings || {}).deep_dup
      existing = Array(settings["class_resources"])
      existing_urls = existing.filter_map { |resource| resource["url"].to_s.presence }.to_set
      settings["class_resources"] = existing + ALUMNI_RESOURCES.reject { |resource| existing_urls.include?(resource.fetch("url")) }
      cohort.update!(settings: settings)
    end
  end

  def alumni_cohorts
    MigrationCohort.where(cohort_type: 2)
  end

  def create_default_channel!(workspace, cohort)
    alumni = cohort[:cohort_type].to_i == 2
    MigrationChannel.create!(
      workspace_id: workspace.id,
      cohort_id: cohort.id,
      name: alumni ? "Alumni Chat" : "Class Chat",
      description: alumni ? "Ongoing discussion and support for Code School of Guam alumni." : "General class discussion for this cohort.",
      visibility: 0,
      status: 0,
      position: 0,
      created_at: Time.current,
      updated_at: Time.current
    )
  end

  def archive_legacy_channel!(channel)
    channel.update!(
      name: "#{channel.name} (archived #{channel.id})",
      status: 1
    )
  end

  def unique_slug_for(cohort)
    base = cohort.name.to_s.parameterize.presence || "workspace"
    "#{base}-#{cohort.id}"
  end

  def archived_cohort?(cohort)
    cohort[:status].to_i == 3
  end
end
