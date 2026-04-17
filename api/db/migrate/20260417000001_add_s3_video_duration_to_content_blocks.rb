class AddS3VideoDurationToContentBlocks < ActiveRecord::Migration[8.1]
  def change
    add_column :content_blocks, :s3_video_duration_seconds, :integer
  end
end
