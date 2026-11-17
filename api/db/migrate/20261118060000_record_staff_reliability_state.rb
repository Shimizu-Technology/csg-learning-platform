class RecordStaffReliabilityState < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    with_lock_timeout do
      add_column :enrollments, :paused_lesson_ids, :bigint, array: true unless column_exists?(:enrollments, :paused_lesson_ids)
      add_column :enrollments, :paused_library_cutoff_at, :datetime unless column_exists?(:enrollments, :paused_library_cutoff_at)
      add_column :announcements, :schedule_failure, :string unless column_exists?(:announcements, :schedule_failure)
    end
    Enrollment.reset_column_information
    # Preserve exactly today's readable set; never guess historical releases.
    Enrollment.where(status: :paused, paused_lesson_ids: nil).find_each do |enrollment|
      enrollment.with_lock do
        next unless enrollment.paused? && enrollment.paused_lesson_ids.nil?

        enrollment.snapshot_paused_lessons
        enrollment.update_columns(paused_lesson_ids: enrollment.paused_lesson_ids, paused_library_cutoff_at: enrollment.paused_library_cutoff_at)
      end
    end
  end

  def down
    with_lock_timeout do
      remove_column :enrollments, :paused_lesson_ids if column_exists?(:enrollments, :paused_lesson_ids)
      remove_column :enrollments, :paused_library_cutoff_at if column_exists?(:enrollments, :paused_library_cutoff_at)
      remove_column :announcements, :schedule_failure if column_exists?(:announcements, :schedule_failure)
    end
  end

  private

  # Keep SET LOCAL and DDL on one pooled PostgreSQL session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      block.call
    end
  end
end
