class Submission < ApplicationRecord
  enum :grade, { A: 0, B: 1, C: 2, R: 3 }
  enum :submission_type, {
    manual_complete: 0,
    text_submission: 1,
    prework_github_sync: 2,
    repo_url_submission: 3,
    repo_and_live_url_submission: 4
  }, prefix: true

  belongs_to :content_block
  belongs_to :user
  belongs_to :enrollment, optional: true
  belongs_to :grader, class_name: "User", foreign_key: :graded_by_id, optional: true
  has_many :submission_criterion_results, dependent: :destroy
  has_many :github_check_runs, dependent: :destroy

  # Enrollment locks serialize create/grade; this query must run inside that lock
  # when deciding whether a grade may be saved. IDs break equal timestamp ties.
  def latest_attempt
    Submission.where(enrollment_id: enrollment_id, user_id: user_id, content_block_id: content_block_id)
      .order(created_at: :desc, id: :desc).first
  end

  def effective_submission_type
    submission_type.presence || content_block.submission_type_for(enrollment)
  end

  # Validate the merged work record at the student-work API boundary. Grading or
  # importing historical records does not retroactively validate their artifacts.
  def validate_required_content
    required = case effective_submission_type
    when "text_submission" then { text: "Submission text is required" }
    when "repo_url_submission" then { repo_url: "Repository URL is required" }
    when "repo_and_live_url_submission" then { repo_url: "Repository URL is required", live_url: "Live URL is required" }
    else {}
    end
    required.each { |field, message| errors.add(field, message) if public_send(field).to_s.strip.blank? }
    errors.empty?
  end

  validates :content_block_id, presence: true
  validates :user_id, presence: true
end
