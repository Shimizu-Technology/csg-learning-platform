require_relative "../support/model_coverage"

class PendingS3DeletionTest < ModelCoverageTestCase
  KEY = "cohort_file_uploads/cohort_1/2b7e1516-28ae-4d2a-a6ab-f7158809cf4f/notes.pdf".freeze

  setup do
    @originals = %i[configured? delete_object].to_h { |name| [ name, S3Service.method(name) ] }
    @deleted = []
    @delete_result = true
    test_case = self
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:delete_object) do |key|
      test_case.instance_variable_get(:@deleted) << key
      test_case.instance_variable_get(:@delete_result)
    end
  end

  teardown { @originals.each { |name, implementation| S3Service.define_singleton_method(name, implementation) } }

  test "enqueueing is idempotent per key and never raises" do
    assert PendingS3Deletion.enqueue!(KEY, reason: "cohort_file_destroyed")
    assert PendingS3Deletion.enqueue!(KEY, reason: "cohort_file_destroyed")
    assert_equal 1, PendingS3Deletion.where(key: KEY).count
    assert_not PendingS3Deletion.enqueue!(nil, reason: "cohort_file_destroyed")
  end

  test "draining deletes due keys, backs off failures, and drops keys that are in use again" do
    PendingS3Deletion.enqueue!(KEY, reason: "cohort_file_destroyed")
    assert_equal 0, PendingS3Deletion.drain!(now: Time.current), "not due before the first retry"
    assert_empty @deleted

    @delete_result = false
    metrics = {}
    PendingS3Deletion.drain!(now: 10.minutes.from_now, metrics: metrics)
    row = PendingS3Deletion.find_by!(key: KEY)
    assert_equal 1, row.attempts
    assert_equal 10.minutes.from_now + 10.minutes, row.next_attempt_at
    assert_equal({ deleted: 0, retrying: 1 }, metrics)

    @delete_result = true
    assert_equal 1, PendingS3Deletion.drain!(now: 1.hour.from_now)
    assert_not PendingS3Deletion.exists?(key: KEY)

    in_use = "cohort_files/cohort_#{course.id}/shared/2b7e1516-28ae-4d2a-a6ab-f7158809cf4f/notes.pdf"
    CohortFile.create!(cohort: course, uploaded_by: staff, title: "Notes", filename: "notes.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: in_use, upload_key: "u-in-use", upload_expires_at: 1.hour.from_now)
    PendingS3Deletion.enqueue!(in_use, reason: "cohort_file_copy_rolled_back")
    PendingS3Deletion.drain!(now: 2.hours.from_now)
    assert_not PendingS3Deletion.exists?(key: in_use)
    assert_equal [ KEY ] * 2, @deleted, "a referenced key is never deleted"
  end

  test "draining waits for storage and stops after the last attempt" do
    PendingS3Deletion.enqueue!(KEY, reason: "cohort_file_destroyed")
    S3Service.define_singleton_method(:configured?) { false }
    assert_equal 0, PendingS3Deletion.drain!(now: 1.day.from_now)
    assert PendingS3Deletion.exists?(key: KEY)
    S3Service.define_singleton_method(:configured?) { true }
    PendingS3Deletion.where(key: KEY).update_all(attempts: PendingS3Deletion::MAX_ATTEMPTS)
    PendingS3Deletion.drain!(now: 2.days.from_now)
    assert_empty @deleted
    assert_equal 1.day, PendingS3Deletion.backoff(20)
  end
end
