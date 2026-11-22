require "test_helper"
require Rails.root.join("db/migrate/20261122030000_create_lesson_recordings").to_s

class CreateLessonRecordingsTest < ActiveSupport::TestCase
  test "migration is reversible and rerunnable with pooled statement caches cleared" do
    migration = CreateLessonRecordings.new
    connection = ActiveRecord::Base.connection
    assert_equal 0, LessonRecording.count

    2.times { migration.migrate(:down) }
    reset_cache
    assert_not connection.table_exists?(:lesson_recordings)

    2.times { migration.migrate(:up) }
    reset_cache
    assert_equal 0, LessonRecording.count
    assert connection.index_exists?(:lesson_recordings, [ :recording_id, :lesson_id ], unique: true)
    assert connection.index_exists?(:lesson_recordings, [ :lesson_id, :position ])
    assert_equal({ "lessons" => :cascade, "recordings" => :cascade },
      connection.foreign_keys(:lesson_recordings).to_h { |key| [ key.to_table, key.on_delete ] })
    assert_equal "0", LessonRecording.columns_hash.fetch("position").default
  ensure
    reset_cache
  end

  private

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    LessonRecording.reset_column_information
  end
end
