class AddCatalogCopyToCohorts < ActiveRecord::Migration[8.1]
  def change
    reversible { |dir| dir.up { execute "SET LOCAL lock_timeout = '5s'" } }
    add_column :cohorts, :public_title, :string
    add_column :cohorts, :public_description, :text
    add_column :cohorts, :public_image_url, :string
  end
end
