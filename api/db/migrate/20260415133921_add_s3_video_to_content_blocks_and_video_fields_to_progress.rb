class AddS3VideoToContentBlocksAndVideoFieldsToProgress < ActiveRecord::Migration[8.1]
  def change
    add_column :content_blocks, :s3_video_key, :string
    add_column :content_blocks, :s3_video_content_type, :string
    add_column :content_blocks, :s3_video_size, :bigint

    add_column :progresses, :video_last_position, :integer, default: 0
    add_column :progresses, :video_total_watched, :integer, default: 0
    add_column :progresses, :video_duration, :integer
  end
end
