require "test_helper"
require "timeout"
require_relative "../support/course_package_fixture"

class CoursePackageConcurrencyTest < ActiveSupport::TestCase
  include CoursePackageFixture
  self.use_transactional_tests = false

  test "a concurrent staff correction is retained when a revision waits for content locks" do
    data = package
    data["key"] = "concurrent-package-correction"
    result = CoursePackageImporter.new(data).call
    @curriculum = Curriculum.find(result[:curriculum_id])
    block_id = @curriculum.modules.first.lessons.first.content_blocks.last.id
    data["revision"] = "2026-10-05"
    held = Queue.new
    release_editor = Queue.new
    importer_started = Queue.new
    editor = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        ContentBlock.transaction do
          block = ContentBlock.lock.find(block_id)
          block.update!(body: "Concurrent staff correction")
          held << true
          release_editor.pop
        end
      end
    end
    Timeout.timeout(10) { held.pop }
    importer = CoursePackageImporter.new(data)
    importer.define_singleton_method(:lock_imported_content!) do |curriculum|
      importer_started << true
      super(curriculum)
    end
    worker = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        begin
          importer.call
        rescue CoursePackageImporter::InvalidPackage => error
          error
        end
      end
    end
    Timeout.timeout(10) { importer_started.pop }
    release_editor << true
    Timeout.timeout(10) { editor.join; worker.join }
    assert_instance_of CoursePackageImporter::InvalidPackage, worker.value
    assert_equal "Concurrent staff correction", ContentBlock.find(block_id).body
    assert_equal "2026-10-04", @curriculum.reload.course_package_revision
  ensure
    release_editor << true if release_editor
    editor&.join(10)
    worker&.join(10)
    @curriculum&.destroy!
  end

  test "database deadlock conflicts roll back and return a retryable package error" do
    data = package
    data["key"] = "concurrent-package-deadlock"
    result = CoursePackageImporter.new(data).call
    @curriculum = Curriculum.find(result[:curriculum_id])
    data["revision"] = "2026-10-05"
    importer = CoursePackageImporter.new(data)
    importer.define_singleton_method(:lock_imported_content!) { |_curriculum| raise ActiveRecord::Deadlocked, "simulated database conflict" }
    assert_raises(CoursePackageImporter::InvalidPackage) { importer.call }
    assert_equal "2026-10-04", @curriculum.reload.course_package_revision
  ensure
    @curriculum&.destroy!
  end
end
