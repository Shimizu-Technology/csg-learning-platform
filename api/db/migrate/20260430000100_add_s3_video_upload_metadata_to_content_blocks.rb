class AddS3VideoUploadMetadataToContentBlocks < ActiveRecord::Migration[8.1]
  def change
    add_reference :content_blocks, :s3_video_uploaded_by, foreign_key: { to_table: :users }, index: true
    add_column :content_blocks, :s3_video_uploaded_at, :datetime
  end
end
