class AddCatalogCopyToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_column :cohorts, :public_title, :string
    add_column :cohorts, :public_description, :text
    add_column :cohorts, :public_image_url, :string
  end
end
