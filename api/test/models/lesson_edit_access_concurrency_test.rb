require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two real connections: a revoke must not slip between an instructor's
# access check and the commit of their save (LessonEditAccess, lock: true).
class LessonEditAccessConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Grant race #{slug}")
    @cohort = Cohort.create!(name: "Grant race class #{slug}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, body: "Before")
    @admin = User.create!(clerk_id: "grant_race_admin_#{slug}", email: "grant-race-admin-#{slug}@example.invalid", role: :admin)
    @instructor = User.create!(clerk_id: "grant_race_instructor_#{slug}", email: "grant-race-instructor-#{slug}@example.invalid", role: :instructor)
    @assignment = CohortInstructorAssignment.create!(cohort: @cohort, user: @instructor)
    @assignment.set_lesson_editing!(true, by: @admin)
    @other_curriculum = Curriculum.create!(name: "Grant race other #{slug}")
    @other_cohort = Cohort.create!(name: "Grant race other class #{slug}", curriculum: @other_curriculum, start_date: Date.current, status: :active)
    @joined = []
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    ActivityEvent.where(subject_user_id: @instructor&.id).delete_all
    CohortInstructorAssignment.where(id: @assignment&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: @module&.id).delete_all
    (@joined.to_a + [ @cohort, @other_cohort ]).compact.each { |cohort| Cohort.find_by(id: cohort.id)&.destroy! }
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    Curriculum.find_by(id: @other_curriculum&.id)&.destroy!
    delete_test_users(@admin, @instructor)
  end

  { "revoke" => ->(assignment, admin) { CohortInstructorAssignment.find(assignment.id).set_lesson_editing!(false, by: admin) },
    "removal from the cohort" => ->(assignment, _admin) { CohortInstructorAssignment.find(assignment.id).destroy! } }.each do |label, change|
    test "a #{label} waits for a save already past its access check, and later saves are refused" do
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
        @lesson.with_authoring_lock { @block.update!(body: "Saved by the instructor") }

        @threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection { change.call(@assignment, @admin) }
        end
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      Timeout.timeout(60) { @threads.first.value }
      assert_equal "Saved by the instructor", @block.reload.body
      error = assert_raises(LessonEditAccess::Denied) do
        ApplicationRecord.transaction { LessonEditAccess.authorize!(@instructor, @curriculum, lock: true) }
      end
      assert_equal "lesson_editing_not_granted", error.code
    end
  end

  # Changes to which cohorts use the curriculum, run on a second connection.
  MEMBERSHIP_CHANGES = {
    "a new cohort on the curriculum" => [ "curriculum_shared", ->(t) { t.joined << Cohort.create!(name: "Joined #{SecureRandom.hex(3)}", curriculum: t.curriculum, start_date: Date.current, status: :upcoming) } ],
    "another curriculum's cohort moving onto it" => [ "curriculum_shared", ->(t) { Cohort.find(t.other_cohort.id).update!(curriculum_id: t.curriculum.id) } ],
    "the instructor's granted cohort moving off it" => [ "lesson_editing_not_granted", ->(t) { Cohort.find(t.cohort.id).update!(curriculum_id: t.other_curriculum.id) } ]
  }.freeze

  attr_reader :curriculum, :other_curriculum, :cohort, :other_cohort, :joined

  MEMBERSHIP_CHANGES.each do |label, (code, change)|
    test "#{label} waits for a save already past its access check, and later saves are refused" do
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
        @lesson.with_authoring_lock { @block.update!(body: "Saved by the instructor") }

        @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { change.call(self) } }
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      Timeout.timeout(60) { @threads.first.value }
      assert_equal "Saved by the instructor", @block.reload.body
      error = assert_raises(LessonEditAccess::Denied) do
        ApplicationRecord.transaction { LessonEditAccess.authorize!(@instructor, @curriculum, lock: true) }
      end
      assert_equal code, error.code
    end

    test "a save that starts while #{label} is uncommitted waits for it and is refused" do
      result = nil
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        change.call(self)

        @threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            ApplicationRecord.transaction do
              LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
              @lesson.with_authoring_lock { ContentBlock.find(@block.id).update!(body: "Saved after the change") }
            end
            :saved
          rescue LessonEditAccess::Denied => error
            error.code
          end
        end
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      assert_equal code, Timeout.timeout(60) { @threads.first.value }
      assert_equal "Before", @block.reload.body
    end
  end

  test "a duplicate and a move of the same lesson don't deadlock" do
    target = CurriculumModule.create!(curriculum: @curriculum, name: "Target", position: 1, day_offset: 0, schedule_days: "weekdays")
    copy = nil
    lesson = Lesson.find(@lesson.id)
    move = Thread.new do
      Thread.stop
      ActiveRecord::Base.connection_pool.with_connection do
        LessonMove.new(lesson: Lesson.find(@lesson.id), module_id: target.id, release_day: 0, position: 0, base_updated_at: lesson.updated_at.iso8601(6)).move!
        :moved
      rescue StandardError => error
        error.class.name
      end
    end
    @threads << move
    test_case = self
    # Pause the duplicate once it holds the original lesson, and let the move
    # start then: it must queue behind the duplicate as a whole (curriculum
    # first) instead of taking the module the duplicate still needs.
    lesson.define_singleton_method(:reload) do |*args|
      unless @paused
        @paused = true
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        Thread.pass until move.stop?
        move.wakeup
        test_case.wait_for_lock_waiters(holder_pid, workers: [ move ])
      end
      super(*args)
    end

    copy = LessonDuplicate.new(lesson: lesson, user: @admin).duplicate!

    assert_equal :moved, Timeout.timeout(60) { move.value }
    assert_equal target.id, @lesson.reload.module_id
    assert_equal @module.id, copy.reload.module_id
  ensure
    if copy
      ContentBlock.where(lesson_id: copy.id).delete_all
      Lesson.where(id: copy.id).delete_all
    end
    Lesson.where(id: @lesson&.id).update_all(module_id: @module.id)
    CurriculumModule.where(id: target&.id).delete_all
  end

  # The block editor verifies a new video key (taking its advisory lock)
  # before it waits for the lesson. If a video changed after Duplicate's own
  # storage check, Duplicate must not validate the new key under the lesson
  # lock: it rolls back and checks storage again, so the editor saves and the
  # copy carries the editor's videos.
  test "a duplicate whose video changed after its storage check retries instead of deadlocking a block editor save" do
    key_a = "content_videos/#{SecureRandom.uuid}/a.mp4"
    key_b = "content_videos/#{SecureRandom.uuid}/b.mp4"
    @block.update!(block_type: :video, s3_video_key: key_a)
    copy = nil
    source = Lesson.find(@lesson.id)
    source.content_blocks.load
    curriculum_id = @curriculum.id
    block_id = @block.id
    admin = @admin
    threads = @threads
    test_case = self
    verified_keys = []

    originals = { configured?: S3Service.method(:configured?), object_exists?: S3Service.method(:object_exists?) }
    original_verify = S3ObjectCleanup.method(:verify_attachment)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:object_exists?) { |_key| true }
    replaced = false
    # Another author replaces video A with B and commits while Duplicate
    # holds A's advisory lock, before Duplicate takes any row lock.
    S3ObjectCleanup.define_singleton_method(:verify_attachment) do |key|
      result = original_verify.call(key)
      if Thread.current == Thread.main
        verified_keys << key
        if key == key_a && !replaced
          replaced = true
          Thread.new do
            ActiveRecord::Base.connection_pool.with_connection do
              ApplicationRecord.transaction do
                original_verify.call(key_b)
                Curriculum.lock_for_content!(curriculum_id)
                Lesson.find(source.id).with_authoring_lock do
                  block = ContentBlock.find(block_id)
                  block.verified_s3_video_key = key_b
                  block.update!(s3_video_key: key_b)
                end
              end
            end
          end.value
        end
      end
      result
    end
    # Once Duplicate holds the lesson, an editor that already verified B
    # (holding B's advisory lock) queues for the lesson.
    source.define_singleton_method(:reload) do |*args|
      result = super(*args)
      unless @editor_started
        @editor_started = true
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            editing = Lesson.find(id)
            LessonBlockEditor.new(
              lesson: editing, user: admin,
              before_lock: -> { Curriculum.lock_for_content!(curriculum_id) },
              params: { base_updated_at: editing.updated_at.iso8601(6),
                        blocks: [ { id: block_id, block_type: "video", s3_video_key: key_b },
                                  { client_id: "extra-video", block_type: "video", s3_video_key: key_b,
                                    s3_video_content_type: "video/mp4", s3_video_size: 1024 } ] }
            ).save!
            :saved
          rescue StandardError => error
            "#{error.class}: #{error.message}"
          end
        end
        test_case.wait_for_lock_waiters(holder_pid, workers: [ threads.last ])
      end
      result
    end

    copy = LessonDuplicate.new(lesson: source, user: @admin).duplicate!

    assert_equal :saved, Timeout.timeout(60) { @threads.last.value }
    assert_equal [ key_a, key_b ], verified_keys, "the retry checks the new video in storage before taking row locks"
    assert_equal [ key_b, key_b ], copy.reload.content_blocks.order(:position).pluck(:s3_video_key)
    assert_equal [ key_b, key_b ], ContentBlock.where(lesson_id: @lesson.id).order(:position).pluck(:s3_video_key)
  ensure
    S3ObjectCleanup.define_singleton_method(:verify_attachment, original_verify) if original_verify
    originals&.each { |name, method| S3Service.define_singleton_method(name, method) }
    if copy
      ContentBlock.where(lesson_id: copy.id).delete_all
      Lesson.where(id: copy.id).delete_all
    end
  end

  test "a duplicate gives up after MAX_ATTEMPTS when the video keeps changing under it" do
    @block.update!(block_type: :video, s3_video_key: "content_videos/#{SecureRandom.uuid}/first.mp4")
    curriculum_id = @curriculum.id
    lesson_id = @lesson.id
    block_id = @block.id
    attempts = 0
    originals = { configured?: S3Service.method(:configured?), object_exists?: S3Service.method(:object_exists?) }
    original_verify = S3ObjectCleanup.method(:verify_attachment)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:object_exists?) { |_key| true }
    # Every storage check is followed by another author's replacement.
    S3ObjectCleanup.define_singleton_method(:verify_attachment) do |key|
      result = original_verify.call(key)
      if Thread.current == Thread.main
        attempts += 1
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            ApplicationRecord.transaction do
              next_key = "content_videos/#{SecureRandom.uuid}/next.mp4"
              original_verify.call(next_key)
              Curriculum.lock_for_content!(curriculum_id)
              Lesson.find(lesson_id).with_authoring_lock do
                block = ContentBlock.find(block_id)
                block.verified_s3_video_key = next_key
                block.update!(s3_video_key: next_key)
              end
            end
          end
        end.value
      end
      result
    end

    error = assert_raises(ActiveRecord::RecordInvalid) { LessonDuplicate.new(lesson: Lesson.find(@lesson.id), user: @admin).duplicate! }

    assert_equal LessonDuplicate::MAX_ATTEMPTS, attempts
    assert_match "videos kept changing", error.message
    assert_equal 1, Lesson.unscoped.where(module_id: @module.id).count, "no copy is left behind"
  ensure
    S3ObjectCleanup.define_singleton_method(:verify_attachment, original_verify) if original_verify
    originals&.each { |name, method| S3Service.define_singleton_method(name, method) }
  end
end
