class AddPublicPriceToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_column :cohorts, :public_price_cents, :integer
    add_check_constraint :cohorts, "public_price_cents IS NULL OR public_price_cents > 0", name: "cohort_public_price_positive"
  end
end
