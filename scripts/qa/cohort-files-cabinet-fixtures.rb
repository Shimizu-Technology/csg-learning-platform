require_relative "boot"

# Synthetic class files, a two-version Markdown file and links for the
# cohort files cabinet QA (cohort-files-cabinet.spec.ts). No stored objects:
# the spec stubs storage-only responses (preview text) in the browser.
cohort = Cohort.find_by!(name: "QA Program")
admin = User.find(1)
student = User.find(3)
cohort.cohort_files.where("title LIKE ?", "QA cabinet%").destroy_all

def stored(cohort, attributes)
  token = SecureRandom.uuid
  owner = attributes[:student] ? "student_#{attributes[:student].id}" : "shared"
  cohort.cohort_files.create!(
    **attributes, file_size: 4_800, content_type: CohortFile.normalized_content_type(attributes[:filename], ""), ready: true,
    s3_key: "cohort_files/cohort_#{cohort.id}/#{owner}/#{token}/#{attributes[:filename]}",
    upload_key: "cohort_file_uploads/cohort_#{cohort.id}/#{token}/#{attributes[:filename]}", upload_expires_at: 1.day.ago
  )
end

notes = stored(cohort, title: "QA cabinet week 1 notes", filename: "week-1-notes.md", folder: "Guides & Handouts", uploaded_by: admin)
first = notes.versions.create!(version_number: 1, ready: true, ready_at: 2.days.ago, filename: notes.filename, content_type: notes.content_type,
  file_size: 4_000, s3_key: notes.s3_key, upload_key: notes.upload_key, upload_expires_at: 2.days.ago, uploaded_by: admin)
token = SecureRandom.uuid
second = notes.versions.create!(version_number: 2, ready: true, ready_at: 1.hour.ago, filename: "week-1-notes-v2.md", content_type: notes.content_type,
  file_size: 4_800, note: "Added loop examples", uploaded_by: admin, upload_expires_at: 2.hours.ago,
  s3_key: "cohort_files/cohort_#{cohort.id}/shared/#{token}/week-1-notes-v2.md", upload_key: "cohort_file_uploads/cohort_#{cohort.id}/#{token}/week-1-notes-v2.md")
notes.update!(version_number: 2, s3_key: second.s3_key, upload_key: second.upload_key, filename: second.filename, ready_at: second.ready_at)
stored(cohort, title: "QA cabinet roster", filename: "roster.csv", folder: "Guides & Handouts", uploaded_by: admin)
stored(cohort, title: "QA cabinet job search plan", filename: "job-search-plan.docx", folder: "Career & Job Search", uploaded_by: admin)
cohort.cohort_files.create!(kind: "link", title: "QA cabinet capstone brief", external_url: "https://docs.google.com/document/d/qa-cabinet/edit",
  folder: "Guides & Handouts", uploaded_by: admin, ready: true)
stored(cohort, title: "QA cabinet resume draft", filename: "resume.pdf", folder: "Resumes & Portfolio", student: student, uploaded_by: student)
cohort.cohort_files.create!(kind: "link", title: "QA cabinet portfolio repo", external_url: "https://github.com/qa-student/portfolio",
  folder: "Resumes & Portfolio", student: student, uploaded_by: student, ready: true)
state = { cohort_id: cohort.id, notes_id: notes.id, versions: [ first.id, second.id ] }
File.write(File.expand_path("../../.qa-local/cohort-files-cabinet.json", __dir__), state.to_json)
puts state.to_json
