require "test_helper"

class CourseCompletionTest < ActionDispatch::IntegrationTest
  setup do
    SchoolSetting.current.update!(features: { certificates: true })
    @learner = person("Learner", :student)
    @instructor = person("Reviewer", :instructor)
    @other_instructor = person("Unassigned", :instructor)
    @admin = person("Admin", :admin)
    @curriculum = Curriculum.create!(name: "Python course")
    @mod = @curriculum.modules.create!(name: "Projects", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = @mod.lessons.create!(title: "Final project", position: 0, release_day: 0, required: true, lesson_type: :project)
    @project = @lesson.content_blocks.create!(title: "Build a tool", block_type: :exercise, position: 0,
      submission_type: :text_submission, metadata: { final_project: true })
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Private cohort", public_title: "Python Foundations",
      course_delivery: "guided", start_date: 2.weeks.ago.to_date, status: :active,
      settings: { features: { certificates: true }, next_step: { title: "Keep learning", offering_slug: "python-next" } })
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @learner, cohort: @cohort, status: :active, access_expires_at: 3.months.from_now)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
  end

  test "handed in, redo and a passing revision produce different states through the real API" do
    submission = submit(@project)
    assert_no_difference "Certificate.count" do
      CourseCompletion.evaluate!(@enrollment)
      get certificate_url, headers: headers(@learner)
      assert_response :success
      assert_equal true, response.parsed_body["all_work_handed_in"]
      assert_equal false, response.parsed_body["course_completed"]
      assert_nil response.parsed_body["certificate"]
      assert_nil response.parsed_body["next_step"]
      grade(submission, "R")
      CourseCompletion.evaluate!(@enrollment)
    end
    assert_nil @enrollment.reload.completed_at
    refute LearnerProgress.new(@enrollment).course_completed?

    revision = submit(@project)
    assert_difference "Certificate.count", 1 do
      grade(revision, "C")
      CourseCompletion.evaluate!(@enrollment)
      grade(revision, "B")
    end
    certificate = @enrollment.certificates.active.sole
    assert_equal @instructor, certificate.issued_by
    assert @enrollment.reload.completed_at
    assert @enrollment.active?
    assert_equal 1, certificate.wording_version

    get certificate_url, headers: headers(@learner)
    assert_response :success
    assert_equal true, response.parsed_body["course_completed"]
    assert_equal "python-next", response.parsed_body.dig("next_step", "offering_slug")
    assert_equal certificate.code, response.parsed_body.dig("certificate", "code")

    get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers(@learner)
    assert_response :success
    assert_equal certificate.code, response.parsed_body.dig("lesson", "learning_navigation", "course_completion", "certificate", "code")
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@learner)
    assert_response :success
    assert_equal certificate.code, response.parsed_body.dig("dashboard", "student_today", "course_completion", "certificate", "code")
    get "/api/v1/profile", headers: headers(@learner)
    assert_response :success
    assert_equal certificate.code, response.parsed_body.dig("enrollments", 0, "course_completion", "certificate", "code")
    get "/api/v1/progress/student/#{@learner.id}", params: { cohort_id: @cohort.id }, headers: headers(@instructor)
    assert_response :success
    assert_equal certificate.code, response.parsed_body.dig("course_certificate", "certificate", "code")
  end

  test "optional redo stays visible while required passing work earns a certificate" do
    optional = @mod.lessons.create!(title: "Stretch project", position: 1, release_day: 0, required: false, lesson_type: :project)
    stretch = optional.content_blocks.create!(title: "Add a feature", block_type: :exercise, position: 0, submission_type: :text_submission)
    grade(submit(stretch), "R")
    assert_difference "Certificate.count", 1 do
      grade(submit(@project), "A")
      CourseCompletion.evaluate!(@enrollment)
    end

    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@learner)
    assert_response :success
    today = response.parsed_body.dig("dashboard", "student_today")
    assert today.dig("course_completion", "course_completed")
    assert today.dig("course_completion", "certificate", "code")
    assert_includes today.dig("needs_you", "items").pluck("content_block_id"), stretch.id
  end

  test "verification has an exact public allowlist and keeps snapshots while learner name edits are explicit" do
    grade(submit(@project), "A")
    certificate = @enrollment.certificates.active.sole
    @cohort.update!(public_title: "Renamed")
    @learner.update!(first_name: "Different")

    get "/api/v1/certificates/#{certificate.code}"
    assert_response :success
    assert_equal "no-store", response.headers["Cache-Control"]
    public_certificate = response.parsed_body.fetch("certificate")
    assert_equal %w[code course_title holder_name issued_at issuer_name revoked revoked_at wording_version], public_certificate.keys.sort
    assert_equal "Learner Example", public_certificate["holder_name"]
    assert_equal "Python Foundations", public_certificate["course_title"]
    assert_equal SchoolBrand.current.name, public_certificate["issuer_name"]
    assert_equal false, public_certificate["revoked"]
    assert_nil public_certificate["revoked_at"]
    refute_includes response.body, @learner.email
    refute_includes response.body, @cohort.name

    [ "", "\u00a0", "A" * 121, @learner.email, { name: "Learner" } ].each do |invalid|
      patch certificate_url, params: { holder_name: invalid }, headers: headers(@learner), as: :json
      assert_response :unprocessable_entity
    end
    patch certificate_url, params: { holder_name: "  Chosen   Name " }, headers: headers(@learner), as: :json
    assert_response :success
    assert_equal "Chosen Name", response.parsed_body.dig("certificate", "holder_name")
    get "/api/v1/certificates/#{certificate.code}"
    assert_equal "Chosen Name", response.parsed_body.dig("certificate", "holder_name")

    get "/api/v1/certificates/#{'0' * 12}"
    assert_response :not_found
  end

  test "staff revocation persists through another grade and reissue keeps the old link revoked" do
    submission = submit(@project)
    grade(submission, "A")
    original = @enrollment.certificates.active.sole
    post "#{certificate_url}/revoke", params: { reason: " " }, headers: headers(@instructor), as: :json
    assert_response :unprocessable_entity
    post "#{certificate_url}/revoke", params: { reason: "Private issuance correction" }, headers: headers(@instructor), as: :json
    assert_response :success
    assert_equal @instructor, original.reload.revoked_by
    assert_equal "Private issuance correction", original.revocation_reason
    assert_no_difference "Certificate.count" do
      grade(submission, "B")
      CourseCompletion.evaluate!(@enrollment)
    end
    assert_empty @enrollment.certificates.active

    get "/api/v1/certificates/#{original.code}"
    assert_response :success
    assert_equal true, response.parsed_body.dig("certificate", "revoked")
    assert response.parsed_body.dig("certificate", "revoked_at")
    refute_includes response.body, "Private issuance correction"

    assert_difference "Certificate.count", 1 do
      post "#{certificate_url}/reissue", params: { reason: "Reviewed with updated evidence" }, headers: headers(@instructor), as: :json
      assert_response :success
    end
    replacement = @enrollment.certificates.active.sole
    assert_not_equal original.code, replacement.code
    assert original.reload.revoked_at
    assert_equal "Reviewed with updated evidence", replacement.issuance_reason

    post "#{certificate_url}/reissue", params: { reason: "Corrected the printed record" }, headers: headers(@instructor), as: :json
    assert_response :success
    assert replacement.reload.revoked_at
    assert_equal 1, @enrollment.certificates.active.count
  end

  test "only the owner can update a name and only assigned staff can manage certificates" do
    other = person("Other learner", :student)
    get certificate_url
    assert_response :unauthorized
    get certificate_url, headers: headers(other)
    assert_response :not_found
    patch certificate_url, params: { holder_name: "Another name" }, headers: headers(other), as: :json
    assert_response :not_found
    post "#{certificate_url}/reissue", params: { reason: "Override" }, headers: headers(@learner), as: :json
    assert_response :forbidden
    post "#{certificate_url}/reissue", params: { reason: "Override" }, headers: headers(@other_instructor), as: :json
    assert_response :forbidden
    assert_empty @enrollment.certificates

    post "#{certificate_url}/reissue", params: { reason: "Prior work reviewed offline" }, headers: headers(@instructor), as: :json
    assert_response :success
    assert_nil @enrollment.reload.completed_at
    assert_equal "Prior work reviewed offline", @enrollment.certificates.active.sole.issuance_reason
  end

  test "certificate mutations report authentication and enrollment errors without making writes" do
    patch certificate_url, params: { holder_name: "Unauthenticated" }, as: :json
    assert_response :unauthorized
    %w[reissue revoke].each do |action|
      post "#{certificate_url}/#{action}", params: { reason: "Example" }, as: :json
      assert_response :unauthorized
      post "/api/v1/enrollments/0/certificate/#{action}", params: { reason: "Example" }, headers: headers(@instructor), as: :json
      assert_response :not_found
      post "#{certificate_url}/#{action}", params: { reason: "Example" }, headers: headers(@other_instructor), as: :json
      assert_response :forbidden
    end
    assert_empty @enrollment.certificates
  end

  test "unmarked reviewed work still requires grades, and manual completion can finish the course" do
    @project.update!(metadata: {})
    manual = @lesson.content_blocks.create!(block_type: :exercise, position: 1, submission_type: :manual_complete)
    submission = submit(@project)
    patch "/api/v1/progress", params: { content_block_id: manual.id, cohort_id: @cohort.id, status: "completed" }, headers: headers(@learner), as: :json
    assert_response :success
    assert LearnerProgress.new(@enrollment).all_required_work_handed_in?
    assert_empty @enrollment.certificates

    optional = @mod.lessons.create!(title: "Optional", position: 1, release_day: 0, required: false)
    optional.content_blocks.create!(block_type: :exercise, position: 0, submission_type: :text_submission)
    patch "/api/v1/progress", params: { content_block_id: manual.id, cohort_id: @cohort.id, status: "in_progress" }, headers: headers(@learner), as: :json
    assert_response :success
    grade(submission, "B")
    assert_empty @enrollment.certificates
    assert_difference "Certificate.count", 1 do
      patch "/api/v1/progress", params: { content_block_id: manual.id, cohort_id: @cohort.id, status: "completed" }, headers: headers(@learner), as: :json
      assert_response :success
    end
    assert @enrollment.reload.completed_at
  end

  test "paused and dropped enrollments cannot be issued by evaluation" do
    submission = submit(@project)
    submission.update!(grade: "A", graded_by_id: @instructor.id, graded_at: Time.current)
    %i[paused dropped].each do |status|
      @enrollment.update!(status: status)
      assert_no_difference "Certificate.count" do
        CourseCompletion.evaluate!(@enrollment)
        post "#{certificate_url}/reissue", params: { reason: "Override" }, headers: headers(@instructor), as: :json
        assert_response :unprocessable_entity
      end
      assert_nil @enrollment.reload.completed_at
    end
  end

  test "handing in remaining required work after the final project already passed completes the course" do
    later = @lesson.content_blocks.create!(title: "Reflection", block_type: :exercise, position: 1, submission_type: :text_submission)
    grade(submit(@project), "A")
    assert_empty @enrollment.certificates

    assert_difference "Certificate.count", 1 do
      assert_nil submit(later).grade
    end
    assert @enrollment.reload.completed_at
  end

  test "school settings cannot opt legacy cohorts in and Off grading writes no certificate state" do
    @cohort.update!(settings: {}, course_delivery: "program")
    assert_equal false, FeatureSwitches.for(cohort: @cohort)["certificates"]

    assert_no_difference "Certificate.count" do
      grade(submit(@project), "A")
      CourseCompletion.evaluate!(@enrollment)
      post "#{certificate_url}/reissue", params: { reason: "Override" }, headers: headers(@instructor), as: :json
      assert_response :unprocessable_entity
    end
    assert_nil @enrollment.reload.completed_at
    get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers(@learner)
    assert_response :success
    assert_equal true, response.parsed_body.dig("lesson", "learning_navigation", "course_complete")
    refute response.parsed_body.dig("lesson", "learning_navigation").key?("course_completion")
    get "/api/v1/profile", headers: headers(@learner)
    refute response.parsed_body.dig("enrollments", 0).key?("course_completion")
  end

  test "cohort opt-in requires school activation and the default is Off" do
    assert_equal false, FeatureSwitches::DEFAULTS.fetch("certificates")
    SchoolSetting.current.update!(features: {})
    assert_equal false, FeatureSwitches.for(cohort: @cohort)["certificates"]
    assert_no_difference "Certificate.count" do
      grade(submit(@project), "A")
    end
    assert_nil @enrollment.reload.completed_at
  end

  test "cohort settings accept a safe destination and retain other settings" do
    patch "/api/v1/cohorts/#{@cohort.id}", params: { settings: { next_step: { title: "Next", url: "javascript:alert(1)" } } }, headers: headers(@admin), as: :json
    assert_response :unprocessable_entity
    patch "/api/v1/cohorts/#{@cohort.id}", params: { settings: { next_step: { title: "Next", url: "https://example.test/next" } } }, headers: headers(@admin), as: :json
    assert_response :success
    assert_equal "https://example.test/next", @cohort.reload.settings.dig("next_step", "url")
    assert_equal true, @cohort.settings.dig("features", "certificates")
    patch "/api/v1/cohorts/#{@cohort.id}", params: { settings: { next_step: nil } }, headers: headers(@admin), as: :json
    assert_response :success
    refute @cohort.reload.settings.key?("next_step")
  end

  test "public lookups have their own rate limit" do
    limit = ApiRateLimits::PUBLIC.fetch(:certificate).fetch(:to)
    limit.times do
      get "/api/v1/certificates/#{'0' * 12}"
      assert_response :not_found
    end
    get "/api/v1/certificates/#{'0' * 12}"
    assert_response :too_many_requests
    assert_equal "60", response.headers["Retry-After"]
  end

  private

  def person(first_name, role)
    User.create!(first_name: first_name, last_name: "Example", clerk_id: "certificate_#{first_name}", email: "#{first_name.parameterize}@example.test", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
  def certificate_url = "/api/v1/enrollments/#{@enrollment.id}/certificate"

  def submit(block)
    post "/api/v1/submissions", params: { content_block_id: block.id, cohort_id: @cohort.id, text: "Synthetic project" }, headers: headers(@learner), as: :json
    assert_response :created
    Submission.find(response.parsed_body.dig("submission", "id"))
  end

  def grade(submission, letter)
    patch "/api/v1/submissions/#{submission.id}/grade", params: { grade: letter, feedback: "Review notes",
      base_submission_updated_at: submission.reload.updated_at.iso8601(6) }, headers: headers(@instructor), as: :json
    assert_response :success
  end
end
