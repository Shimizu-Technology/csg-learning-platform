class CreateCurriculumCopies < ActiveRecord::Migration[8.1]
  # "Make a copy for this cohort" (W5 PR 5.3 part 2b, decision 1 in
  # docs/design/2026-11-platform-redesign/README.md §12).
  #
  # - curriculum_copies: one row per cohort copy (who, when, from what, to
  #   what, and the per-table counts it moved). A cohort copies a given
  #   curriculum at most once, which is what makes a retried request safe.
  # - content_redirects: the copy's old content id -> new content id map,
  #   scoped to the cohort. Learners of that cohort can still open the old
  #   ids that installed apps, push notifications and sent links carry.
  #   old_id/new_id have no foreign keys on purpose: the shared lesson may be
  #   deleted later, and the redirect must still resolve.
  # Both are bookkeeping, so they go with their cohort or their copy
  # (ON DELETE CASCADE), and a deleted shared curriculum only clears
  # source_curriculum_id.
  # - enrollments.content_moved_at: a learning write that began before the
  #   copy committed is refused with "reload" (Enrollment#with_learning_write_guard),
  #   the same rule a restart uses.
  # - curriculum_resources.s3_key: the copy references the same published ZIP
  #   (published course files are never deleted: abandon refuses them and a
  #   curriculum with files can't be destroyed), so the key is no longer
  #   unique. upload_key stays unique; copies get their own.
  #
  # Additive and online: new tables, a nullable column, and the s3_key index
  # swap builds the replacement CONCURRENTLY before dropping the unique one.
  # Each step runs in its own transaction with SET LOCAL lock_timeout so the
  # timeout and DDL share one session through Neon's pooler
  # (docs/DEPLOYMENT.md, migration rules).
  disable_ddl_transaction!

  LOCK_TIMEOUT = "5s"
  UNIQUE_S3_INDEX = "index_curriculum_resources_on_s3_key"
  SHARED_S3_INDEX = "index_curriculum_resources_on_shared_s3_key"

  def up
    with_lock_timeout do
      unless table_exists?(:curriculum_copies)
        create_table :curriculum_copies do |t|
          t.references :cohort, null: false, foreign_key: { on_delete: :cascade }, index: false
          t.bigint :source_curriculum_id
          t.bigint :copy_curriculum_id, null: false
          t.bigint :created_by_id
          t.jsonb :counts, null: false, default: {}
          t.datetime :created_at, null: false
          t.index %i[cohort_id source_curriculum_id], unique: true, name: "index_curriculum_copies_once_per_cohort_source"
          t.index :copy_curriculum_id, unique: true
          t.index :source_curriculum_id
          t.index :created_by_id
        end
        add_foreign_key :curriculum_copies, :curricula, column: :source_curriculum_id, on_delete: :nullify
        add_foreign_key :curriculum_copies, :curricula, column: :copy_curriculum_id, on_delete: :cascade
        add_foreign_key :curriculum_copies, :users, column: :created_by_id, on_delete: :nullify
      end

      unless table_exists?(:content_redirects)
        create_table :content_redirects do |t|
          t.references :curriculum_copy, null: false, foreign_key: { on_delete: :cascade }
          t.references :cohort, null: false, foreign_key: { on_delete: :cascade }, index: false
          t.string :record_type, limit: 32, null: false
          t.bigint :old_id, null: false
          t.bigint :new_id, null: false
          t.datetime :created_at, null: false
          t.index %i[cohort_id record_type old_id], unique: true, name: "index_content_redirects_on_cohort_type_old"
          t.check_constraint "record_type IN ('CurriculumModule', 'Lesson', 'ContentBlock', 'KnowledgeCheck')", name: "content_redirects_record_type_valid"
        end
      end

      add_column :enrollments, :content_moved_at, :datetime unless column_exists?(:enrollments, :content_moved_at)
    end

    build_index_concurrently(SHARED_S3_INDEX, unique: false)
    with_lock_timeout { remove_index :curriculum_resources, name: UNIQUE_S3_INDEX } if index_name_exists?(:curriculum_resources, UNIQUE_S3_INDEX)
  end

  def down
    # Restoring the unique index fails while a copy shares a ZIP key; that is
    # intended (drop the copies first).
    build_index_concurrently(UNIQUE_S3_INDEX, unique: true)
    with_lock_timeout do
      remove_index :curriculum_resources, name: SHARED_S3_INDEX if index_name_exists?(:curriculum_resources, SHARED_S3_INDEX)
      remove_column :enrollments, :content_moved_at if column_exists?(:enrollments, :content_moved_at)
      drop_table :content_redirects if table_exists?(:content_redirects)
      drop_table :curriculum_copies if table_exists?(:curriculum_copies)
    end
  end

  private

  # A failed concurrent build leaves an invalid index behind; a retry drops
  # and rebuilds it rather than trusting the name.
  def build_index_concurrently(name, unique:)
    valid = index_name_exists?(:curriculum_resources, name) && connection.select_value(<<~SQL)
      SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(#{connection.quote(name)})
    SQL
    return if valid

    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(name)}"
    add_index :curriculum_resources, :s3_key, unique: unique, name: name, algorithm: :concurrently
  end

  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end
end
