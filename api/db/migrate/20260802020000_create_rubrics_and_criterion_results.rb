class CreateRubricsAndCriterionResults < ActiveRecord::Migration[8.1]
  def change
    create_table :rubrics do |t|
      t.references :curriculum, null: false, foreign_key: { to_table: :curricula }
      t.string :title, null: false
      t.text :description
      t.boolean :active, null: false, default: true
      t.timestamps
    end

    create_table :rubric_criteria do |t|
      t.references :rubric, null: false, foreign_key: true
      t.references :learning_objective, foreign_key: true
      t.string :title, null: false
      t.text :description, null: false
      t.integer :position, null: false, default: 0
      t.timestamps
    end
    add_check_constraint :rubric_criteria, "position >= 0", name: "rubric_criteria_position_nonnegative"

    add_reference :content_blocks, :rubric, foreign_key: true

    create_table :submission_criterion_results do |t|
      t.references :submission, null: false, foreign_key: true
      t.references :rubric_criterion, null: false, foreign_key: { to_table: :rubric_criteria }
      t.integer :rating, null: false
      t.text :feedback
      t.timestamps
    end
    add_index :submission_criterion_results, [ :submission_id, :rubric_criterion_id ], unique: true,
              name: "idx_submission_criterion_results_unique"
  end
end
