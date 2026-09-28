class AddIntegrationIdentifierToCoursePurchases < ActiveRecord::Migration[8.1]
  def change
    add_column :course_purchases, :integration_identifier, :string
  end
end
