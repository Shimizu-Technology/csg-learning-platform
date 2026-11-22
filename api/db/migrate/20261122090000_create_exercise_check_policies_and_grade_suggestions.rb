class CreateExerciseCheckPoliciesAndGradeSuggestions < ActiveRecord::Migration[8.1]
  # Additive tables and column only; SET LOCAL and all DDL share a transaction on PgBouncer.
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"

      unless column_exists?(:github_check_runs, :check_suite_id)
        add_column :github_check_runs, :check_suite_id, :bigint
      end

      unless table_exists?(:exercise_check_policies)
        create_table :exercise_check_policies do |t|
          t.references :content_block, null: false, foreign_key: { on_delete: :cascade }
          t.integer :version, null: false
          t.boolean :active, null: false, default: true
          t.jsonb :required_checks, null: false, default: []
          t.jsonb :allowed_app_slugs, null: false, default: [ "github-actions" ]
          t.string :allowed_branch
          t.string :expected_workflow_path
          t.string :expected_workflow_sha
          t.references :created_by, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
          t.timestamps
        end
      end

      unless index_exists?(:exercise_check_policies, [ :content_block_id, :version ], unique: true, name: "index_exercise_check_policies_on_block_and_version")
        add_index :exercise_check_policies, [ :content_block_id, :version ], unique: true, name: "index_exercise_check_policies_on_block_and_version"
      end
      unless index_exists?(:exercise_check_policies, :content_block_id, unique: true, where: "active = true", name: "index_exercise_check_policies_active_per_block")
        add_index :exercise_check_policies, :content_block_id, unique: true, where: "active = true", name: "index_exercise_check_policies_active_per_block"
      end

      unless check_constraint_exists?(:exercise_check_policies, name: "exercise_check_policies_version_positive")
        add_check_constraint :exercise_check_policies, "version > 0", name: "exercise_check_policies_version_positive"
      end
      unless check_constraint_exists?(:exercise_check_policies, name: "exercise_check_policies_required_checks_array")
        add_check_constraint :exercise_check_policies, "jsonb_typeof(required_checks) = 'array'", name: "exercise_check_policies_required_checks_array"
      end
      unless check_constraint_exists?(:exercise_check_policies, name: "exercise_check_policies_allowed_app_slugs_array")
        add_check_constraint :exercise_check_policies, "jsonb_typeof(allowed_app_slugs) = 'array'", name: "exercise_check_policies_allowed_app_slugs_array"
      end

      unless table_exists?(:submission_grade_suggestions)
        create_table :submission_grade_suggestions do |t|
          t.references :submission, null: false, foreign_key: { on_delete: :cascade }, index: false
          t.references :enrollment, null: false, foreign_key: { on_delete: :cascade }
          t.references :content_block, null: false, foreign_key: { on_delete: :cascade }
          t.references :exercise_check_policy, null: true, foreign_key: { on_delete: :nullify }
          t.integer :policy_version
          t.string :commit_sha
          t.string :outcome, null: false
          t.string :suggested_grade
          t.string :reason_code, null: false
          t.text :reason_summary, null: false
          t.jsonb :evidence, null: false, default: {}
          t.datetime :evaluated_at, null: false
          t.string :decision
          t.text :override_reason
          t.references :decided_by, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
          t.datetime :decided_at
          t.timestamps
        end
      end

      unless index_exists?(:submission_grade_suggestions, :submission_id, unique: true, name: "index_submission_grade_suggestions_on_submission_id")
        add_index :submission_grade_suggestions, :submission_id, unique: true, name: "index_submission_grade_suggestions_on_submission_id"
      end
      unless index_exists?(:submission_grade_suggestions, [ :enrollment_id, :content_block_id ], name: "index_submission_grade_suggestions_on_enrollment_and_block")
        add_index :submission_grade_suggestions, [ :enrollment_id, :content_block_id ], name: "index_submission_grade_suggestions_on_enrollment_and_block"
      end
      unless index_exists?(:submission_grade_suggestions, :outcome, name: "index_submission_grade_suggestions_on_outcome")
        add_index :submission_grade_suggestions, :outcome, name: "index_submission_grade_suggestions_on_outcome"
      end

      unless check_constraint_exists?(:submission_grade_suggestions, name: "submission_grade_suggestions_outcome_valid")
        add_check_constraint :submission_grade_suggestions,
          "outcome IN ('suggest_b', 'review_for_redo', 'no_suggestion', 'stale_evidence')",
          name: "submission_grade_suggestions_outcome_valid"
      end
      unless check_constraint_exists?(:submission_grade_suggestions, name: "submission_grade_suggestions_suggested_grade_valid")
        add_check_constraint :submission_grade_suggestions,
          "suggested_grade IS NULL OR suggested_grade = 'B'",
          name: "submission_grade_suggestions_suggested_grade_valid"
      end
      unless check_constraint_exists?(:submission_grade_suggestions, name: "submission_grade_suggestions_decision_valid")
        add_check_constraint :submission_grade_suggestions,
          "decision IS NULL OR decision IN ('accepted', 'overridden', 'dismissed')",
          name: "submission_grade_suggestions_decision_valid"
      end
      unless check_constraint_exists?(:submission_grade_suggestions, name: "submission_grade_suggestions_policy_version_positive")
        add_check_constraint :submission_grade_suggestions,
          "policy_version IS NULL OR policy_version > 0",
          name: "submission_grade_suggestions_policy_version_positive"
      end
      unless check_constraint_exists?(:submission_grade_suggestions, name: "submission_grade_suggestions_evidence_object")
        add_check_constraint :submission_grade_suggestions,
          "jsonb_typeof(evidence) = 'object'",
          name: "submission_grade_suggestions_evidence_object"
      end
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :submission_grade_suggestions if table_exists?(:submission_grade_suggestions)
      drop_table :exercise_check_policies if table_exists?(:exercise_check_policies)
      remove_column :github_check_runs, :check_suite_id if column_exists?(:github_check_runs, :check_suite_id)
    end
  end
end
