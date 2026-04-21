class CreateWorkspaces < ActiveRecord::Migration[8.0]
  class MigrationCohort < ApplicationRecord
    self.table_name = "cohorts"
  end

  class MigrationWorkspace < ApplicationRecord
    self.table_name = "workspaces"
  end

  class MigrationChannel < ApplicationRecord
    self.table_name = "channels"
  end

  class MigrationDirectConversation < ApplicationRecord
    self.table_name = "direct_conversations"
  end

  def up
    create_table :workspaces do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.integer :workspace_type, null: false, default: 0
      t.integer :status, null: false, default: 0
      t.text :description
      t.references :cohort, foreign_key: true
      t.timestamps
    end

    add_index :workspaces, :slug, unique: true

    create_table :workspace_memberships do |t|
      t.references :workspace, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.integer :role, null: false, default: 0
      t.timestamps
    end

    add_index :workspace_memberships, [ :workspace_id, :user_id ], unique: true

    add_reference :channels, :workspace, foreign_key: true
    add_reference :direct_conversations, :workspace, foreign_key: true

    say_with_time "Backfilling cohort workspaces and messaging workspace ids" do
      MigrationCohort.find_each do |cohort|
        workspace = MigrationWorkspace.create!(
          name: cohort.name,
          slug: unique_slug_for(cohort.name, cohort.id),
          workspace_type: 0,
          status: archived_cohort?(cohort) ? 1 : 0,
          description: "Workspace for #{cohort.name}",
          cohort_id: cohort.id,
          created_at: Time.current,
          updated_at: Time.current
        )

        MigrationChannel.where(cohort_id: cohort.id).update_all(workspace_id: workspace.id)
        MigrationDirectConversation.where(cohort_id: cohort.id).update_all(workspace_id: workspace.id)
      end
    end

    change_column_null :channels, :workspace_id, false
    change_column_null :direct_conversations, :workspace_id, false

    add_index :channels, [ :workspace_id, :name ], unique: true
    add_index :channels, [ :workspace_id, :status, :position ]
    add_index :direct_conversations, [ :workspace_id, :member_key ], unique: true
  end

  def down
    remove_index :direct_conversations, [ :workspace_id, :member_key ]
    remove_index :channels, [ :workspace_id, :status, :position ]
    remove_index :channels, [ :workspace_id, :name ]

    remove_reference :direct_conversations, :workspace, foreign_key: true
    remove_reference :channels, :workspace, foreign_key: true

    drop_table :workspace_memberships
    drop_table :workspaces
  end

  private

  def unique_slug_for(name, cohort_id)
    base = name.to_s.parameterize.presence || "workspace-#{cohort_id}"
    "#{base}-#{cohort_id}"
  end

  def archived_cohort?(cohort)
    cohort[:status].to_s == "3" || cohort[:status].to_s == "archived"
  end
end
