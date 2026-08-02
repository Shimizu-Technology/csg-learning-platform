class CreateLearningObjectives < ActiveRecord::Migration[8.1]
  def change
    create_table :learning_objectives do |t|
      t.references :curriculum, null: false, foreign_key: { to_table: :curricula }
      t.string :code, null: false
      t.string :title, null: false
      t.text :description
      t.text :success_criteria, null: false
      t.integer :position, null: false, default: 0
      t.boolean :active, null: false, default: true

      t.timestamps
    end
    add_index :learning_objectives, [ :curriculum_id, :code ], unique: true
    add_check_constraint :learning_objectives, "position >= 0", name: "learning_objectives_position_nonnegative"

    create_table :objective_alignments do |t|
      t.references :learning_objective, null: false, foreign_key: true
      t.references :lesson, null: false, foreign_key: true
      t.references :content_block, foreign_key: true
      t.integer :position, null: false, default: 0

      t.timestamps
    end
    add_index :objective_alignments, [ :lesson_id, :learning_objective_id ],
              unique: true, where: "content_block_id IS NULL", name: "idx_objective_alignments_unique_lesson"
    add_index :objective_alignments, [ :content_block_id, :learning_objective_id ],
              unique: true, where: "content_block_id IS NOT NULL", name: "idx_objective_alignments_unique_block"
    add_check_constraint :objective_alignments, "position >= 0", name: "objective_alignments_position_nonnegative"
  end
end
