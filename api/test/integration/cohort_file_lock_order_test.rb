require "test_helper"

# Lock order between deleting a cohort and writing its files, on real
# connections and real commits (no test transaction), so PostgreSQL row-lock
# conflicts and deadlock detection behave as they do in production.
class CohortFileLockOrderTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    # The threads below must never autoload: a load waits for every running
    # thread, including one blocked on a row lock.
    Rails.application.eager_load!
    @tag = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Lock order #{@tag}")
    @cohort = Cohort.create!(name: "Lock order #{@tag}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "lock_order_#{@tag}", email: "lock-order-#{@tag}@example.test", first_name: "Lock", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
  end

  teardown do
    Cohort.find_by(id: @cohort.id)&.destroy!
    @curriculum.reload.destroy!
    @student.destroy!
  end

  test "a cohort deletion waits for a learner write that holds an enrollment, and removes its file, instead of deadlocking" do
    locked = Queue.new
    go = Queue.new
    errors = Queue.new
    writer = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Enrollment.transaction do
          Enrollment.connection.execute("SET LOCAL lock_timeout = '10s'")
          # A learner copy or doc create: the enrollment first, then the file insert.
          Enrollment.lock.find(@enrollment.id)
          locked << true
          go.pop
          CohortFile.create!(cohort_id: @cohort.id, student_id: @student.id, kind: "link", title: "Race #{@tag}",
            external_url: "https://example.com/race", ready: true)
        end
      rescue StandardError => error
        errors << error
      end
    end
    unblocked { locked.pop }
    deleter = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Cohort.transaction do
          Cohort.connection.execute("SET LOCAL lock_timeout = '10s'")
          Cohort.find(@cohort.id).destroy!
        end
      rescue StandardError => error
        errors << error
      end
    end
    # The deletion holds its cohort lock and waits on the writer's enrollment.
    assert unblocked { wait_for { lock_waiters.positive? } }, "the deletion never reached the enrollment lock"
    go << true
    [ writer, deleter ].each { |thread| assert unblocked { thread.join(20) }, "a thread hung" }

    assert_empty errors.size.times.map { errors.pop.class.name }
    assert_not Cohort.exists?(@cohort.id)
    assert_not CohortFile.exists?(title: "Race #{@tag}"), "the file inserted while the deletion waited is deleted with the cohort"
  ensure
    # Never leave the writer holding its lock if an assertion failed early.
    go&.push(true)
    [ writer, deleter ].compact.each { |thread| unblocked { thread.join(20) } }
  end

  test "the deletion's cohort lock still waits for a class import and lets foreign-key checks through" do
    held = Queue.new
    release = Queue.new
    holder = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Cohort.transaction do
          # Cohort#destroy's first statement.
          Cohort.where(id: @cohort.id).lock("FOR NO KEY UPDATE").pluck(:id)
          held << true
          release.pop
        end
      end
    end
    unblocked { held.pop }
    assert_raises(ActiveRecord::LockWaitTimeout, "an import's FOR SHARE must wait for a deletion") do
      Cohort.transaction do
        Cohort.connection.execute("SET LOCAL lock_timeout = '200ms'")
        Cohort.where(id: @cohort.id).lock("FOR SHARE").pick(:id)
      end
    end
    Cohort.transaction do
      Cohort.connection.execute("SET LOCAL lock_timeout = '200ms'")
      assert_equal @cohort.id, Cohort.where(id: @cohort.id).lock("FOR KEY SHARE").pick(:id), "an insert's key check must not wait"
    end
  ensure
    release << true
    unblocked { holder&.join(10) }
  end

  private

  # Waits without holding Rails' load interlock, so the threads can load
  # classes (and never stall behind this one).
  def unblocked(&block)
    ActiveSupport::Dependencies.interlock.permit_concurrent_loads(&block)
  end

  # Sessions waiting on a lock, read on a connection of its own, outside the
  # Rails pool, so the check never queues behind a thread's statement.
  def lock_waiters
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    connection = PG.connect(**{ dbname: config[:database], host: config[:host], port: config[:port], user: config[:username], password: config[:password] }.compact)
    connection.exec("SELECT count(*) FROM pg_locks WHERE NOT granted").getvalue(0, 0).to_i
  ensure
    connection&.close
  end

  def wait_for(seconds: 10)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
    until yield
      return false if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline

      sleep 0.05
    end
    true
  end
end
