class AddCompletedVideoSectionsToProgresses < ActiveRecord::Migration[8.1]
  def change
    add_column :progresses, :completed_video_sections, :jsonb, default: {}, null: false
  end
end
