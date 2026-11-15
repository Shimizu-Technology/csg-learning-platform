require_relative "../support/model_coverage"

class SubmissionTest < ModelCoverageTestCase
  test "latest attempt resolves equal timestamps by id and isolates enrollment and user" do
    first = submission
    second = Submission.create!(user: student, enrollment: enrollment, content_block: block)
    outsider = Submission.create!(user: person, content_block: block)
    assert_equal second, first.latest_attempt
    ids = Submission.latest_attempt_ids_for([ first, outsider ])
    assert_equal second.id, ids[first.attempt_key]
    assert_equal outsider.id, ids[outsider.attempt_key]
    assert_empty Submission.latest_attempt_ids_for([])
    second.update!(grade: :R)
    assert second.reload.R?
  end

  test "required artifacts depend on snapshotted submission type" do
    submission.submission_type = :repo_and_live_url_submission
    assert_not submission.validate_required_content
    assert submission.errors[:repo_url].any?
    assert submission.errors[:live_url].any?
    submission.errors.clear
    submission.repo_url = "https://example.com/repository"
    submission.live_url = "https://example.com/app"
    assert submission.validate_required_content
    submission.submission_type = :text_submission
    submission.text = "  "
    assert_not submission.validate_required_content
    assert submission.errors[:text].any?
  end
end
