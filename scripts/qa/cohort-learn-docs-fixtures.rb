require_relative "boot"

# Synthetic Learn Docs and a review thread for cohort-learn-docs.spec.ts: a
# class template doc, a copy in the QA program student's folder waiting for
# review with a comment each way, and a reviewed upload. No stored objects.
cohort = Cohort.find_by!(name: "QA Program")
admin = User.find(1)
student = User.find(3)
cohort.cohort_files.where("title LIKE ?", "QA docs%").destroy_all

template_content = <<~MARKDOWN
  # Job search plan

  Fill this in before Friday's check-in.

  ## This week

  - [ ] Pick three roles to apply for
  - [x] Update your resume
  - [ ] Ask a classmate to review your portfolio

  | Day | Goal |
  |---|---|
  | Monday | Apply to one role |
  | Wednesday | Practice an interview |

  ```html
  <script src="app.js"></script>
  ```
MARKDOWN
now = Time.current
template = cohort.cohort_files.create!(kind: "doc", title: "QA docs job search template", folder: "Career & Job Search", uploaded_by: admin,
  doc_content: template_content, doc_updated_at: now, doc_updated_by: admin, ready: true)
copy = cohort.cohort_files.create!(kind: "doc", title: "QA docs job search plan", folder: "Career & Job Search", student: student, uploaded_by: admin,
  source_file: template, doc_content: template_content.sub("- [ ] Pick three roles", "- [x] Pick three roles"), doc_updated_at: now, doc_updated_by: student,
  ready: true, review_status: "needs_review")
copy.comments.create!(user: student, body: "I picked my three roles. Can you check them?")
copy.comments.create!(user: admin, body: "Nice start. Add one stretch role.")
token = SecureRandom.uuid
cohort.cohort_files.create!(title: "QA docs cover letter", filename: "cover-letter.pdf", content_type: "application/pdf", file_size: 4_800,
  folder: "Resumes & Portfolio", student: student, uploaded_by: student, ready: true, review_status: "reviewed", reviewed_by: admin, reviewed_at: now,
  s3_key: "cohort_files/cohort_#{cohort.id}/student_#{student.id}/#{token}/cover-letter.pdf",
  upload_key: "cohort_file_uploads/cohort_#{cohort.id}/#{token}/cover-letter.pdf", upload_expires_at: 1.day.ago)
state = { cohort_id: cohort.id, template_id: template.id, copy_id: copy.id, student_id: student.id }
File.write(File.expand_path("../../.qa-local/cohort-learn-docs.json", __dir__), state.to_json)
puts state.to_json
