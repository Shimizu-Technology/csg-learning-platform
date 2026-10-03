require "test_helper"

class CurriculumResourcesTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "Python learner bundle")
    @other = Curriculum.create!(name: "Other paid course")
    @cohort = Cohort.create!(name: "Python course", curriculum: @curriculum, start_date: Date.current, status: :upcoming)
    @admin = user("admin", :admin)
    @student = user("learner", :student)
    @outsider = user("outsider", :student)
    @teacher = user("teacher", :instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 1.hour.from_now)
    @resource = @curriculum.curriculum_resources.create!(title: "Python ZIP", filename: "python.zip", file_size: 123,
      s3_key: "course_resources/curriculum_#{@curriculum.id}/abc/python.zip", upload_key: "course_resource_uploads/abc/python.zip",
      upload_expires_at: 1.hour.from_now, ready: true)
    @signed = []
    @copied = []
    @metadata = { content_type: "application/zip", content_length: 123, etag: "fixture-etag" }
  end

  test "anonymous and unrelated learner cannot obtain a signed URL" do
    post download_path
    assert_response :unauthorized
    with_storage do
      as_user(@outsider) { post download_path, headers: headers }
      assert_response :forbidden
    end
    assert_empty @signed
  end

  test "enrolled learner receives short uncached URL for this curriculum only" do
    with_storage do
      as_user(@student) { post download_path, headers: headers }
      assert_response :success
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_equal [ [ @resource.s3_key, 300 ] ], @signed
      as_user(@student) { post download_path(@other.id), headers: headers }
      assert_response :forbidden
      assert_equal 1, @signed.size
    end
  end

  test "expired paused dropped and completed enrollments cannot download" do
    with_storage do
      %i[paused dropped completed].each do |status|
        @enrollment.update!(status: status)
        as_user(@student) { post download_path, headers: headers }
        assert_response :forbidden
      end
      @enrollment.update!(status: :active, access_expires_at: 1.second.ago)
      as_user(@student) { post download_path, headers: headers }
      assert_response :forbidden
      as_user(@student) { get "/api/v1/resources", params: { cohort_id: @cohort.id, include_course_files: "true" }, headers: headers }
      assert_response :success
      assert_empty JSON.parse(response.body).fetch("resources")
    end
    assert_empty @signed
  end

  test "URL expiry cannot extend course access" do
    @enrollment.update!(access_expires_at: 30.seconds.from_now)
    with_storage do
      as_user(@student) { post download_path, headers: headers }
      assert_response :success
      assert @signed.last.last.between?(1, 30)
    end
  end

  test "staff access requires admin or assignment to matching curriculum" do
    with_storage do
      as_user(@teacher) { post download_path, headers: headers }
      assert_response :forbidden
      CohortInstructorAssignment.create!(cohort: @cohort, user: @teacher)
      as_user(@teacher) { post download_path, headers: headers }
      assert_response :success
      as_user(@admin) { post download_path, headers: headers }
      assert_response :success
    end
  end

  test "staff can stage draft ZIP without activating curriculum or enrollment" do
    with_storage do
      as_user(@admin) do
        post "/api/v1/curricula/#{@curriculum.id}/resources", params: { title: "Python learners", filename: "python.zip", file_size: 123 }, headers: headers, as: :json
      end
      assert_response :created
      result = JSON.parse(response.body)
      pending = CurriculumResource.find(result.fetch("resource").fetch("download_id"))
      assert_not pending.ready?
      assert_match %r{\Acourse_resource_uploads/curriculum_#{@curriculum.id}/}, pending.upload_key
      assert_equal "draft", @curriculum.reload.status
      assert_equal 1, Enrollment.where(cohort: @cohort).count
      as_user(@admin) { post complete_path(pending), headers: headers }
      assert_response :success
      assert pending.reload.ready?
      assert_equal [ [ pending.upload_key, pending.s3_key, "fixture-etag" ] ], @copied
      as_user(@admin) { post complete_path(pending), headers: headers }
      assert_response :success
      assert_equal 1, @copied.size
    end
  end

  test "student uploads active curricula wrong extension and oversize files are rejected" do
    with_storage do
      data = { title: "ZIP", filename: "course.zip", file_size: 123 }
      as_user(@student) { post "/api/v1/curricula/#{@curriculum.id}/resources", params: data, headers: headers, as: :json }
      assert_response :forbidden
      [ data.merge(filename: "key.txt"), data.merge(file_size: 51.megabytes), data.merge(file_size: 0) ].each do |invalid|
        as_user(@admin) { post "/api/v1/curricula/#{@curriculum.id}/resources", params: invalid, headers: headers, as: :json }
        assert_response :unprocessable_entity
      end
      @curriculum.update!(status: :active)
      as_user(@admin) { post "/api/v1/curricula/#{@curriculum.id}/resources", params: data, headers: headers, as: :json }
      assert_response :unprocessable_entity
    end
  end

  test "pending ZIP never appears to learners and cannot be downloaded" do
    @resource.update!(ready: false)
    with_storage do
      as_user(@student) { get "/api/v1/resources", params: { cohort_id: @cohort.id, include_course_files: "true" }, headers: headers }
      assert_response :success
      assert_empty JSON.parse(response.body).fetch("resources")
      as_user(@student) { post download_path, headers: headers }
      assert_response :not_found
    end
    assert_empty @signed
  end

  test "ready ZIP listing is scoped and older link-only clients remain compatible" do
    as_user(@student) { get "/api/v1/resources", params: { cohort_id: @cohort.id, include_course_files: "true" }, headers: headers }
    assert_response :success
    listed = JSON.parse(response.body).fetch("resources").sole
    assert_equal @cohort.id, listed.fetch("cohort_id")
    assert_equal @resource.id, listed.fetch("download_id")
    assert_equal "", listed.fetch("url")
    assert_not_includes response.body, "s3_key"
    as_user(@student) { get "/api/v1/resources", params: { cohort_id: @cohort.id }, headers: headers }
    assert_response :success
    assert_empty JSON.parse(response.body).fetch("resources")
  end

  test "only authorized staff can discover pending uploads for recovery" do
    @resource.update!(ready: false)
    path = "/api/v1/curricula/#{@curriculum.id}/resources"
    as_user(@student) { get path, headers: headers }
    assert_response :success
    assert_empty JSON.parse(response.body).fetch("resources")
    as_user(@teacher) { get path, headers: headers }
    assert_response :forbidden
    as_user(@admin) { get path, headers: headers }
    assert_response :success
    pending = JSON.parse(response.body).fetch("resources").sole
    assert_equal @resource.id, pending.fetch("download_id")
    assert_equal false, pending.fetch("ready")
    assert_not_includes response.body, @resource.upload_key
    assert_not_includes response.body, @resource.s3_key
  end

  test "missing and wrong MIME uploads are not published" do
    @resource.update!(ready: false)
    with_storage do
      [ nil, @metadata.merge(content_type: "text/plain") ].each do |metadata|
        @metadata = metadata
        as_user(@admin) { post complete_path(@resource), headers: headers }
        assert_response :unprocessable_entity
        assert_not @resource.reload.ready?
      end
    end
    assert_empty @copied
  end

  test "cross-course IDs cannot be completed and published files cannot be abandoned" do
    with_storage do
      as_user(@admin) { post "/api/v1/curricula/#{@other.id}/resources/#{@resource.id}/complete", headers: headers }
      assert_response :not_found
      as_user(@admin) { delete "/api/v1/curricula/#{@curriculum.id}/resources/#{@resource.id}", headers: headers }
      assert_response :unprocessable_entity
      assert @resource.reload.ready?
      @resource.update!(ready: false)
      as_user(@student) { delete "/api/v1/curricula/#{@curriculum.id}/resources/#{@resource.id}", headers: headers }
      assert_response :forbidden
      as_user(@admin) { delete "/api/v1/curricula/#{@curriculum.id}/resources/#{@resource.id}", headers: headers }
      assert_response :no_content
      assert_not CurriculumResource.exists?(@resource.id)
    end
  end

  test "missing mismatched and expired uploads cannot be published" do
    @resource.update!(ready: false, file_size: 124)
    with_storage do
      as_user(@admin) { post complete_path(@resource), headers: headers }
      assert_response :unprocessable_entity
      assert_not @resource.reload.ready?
      @resource.update!(file_size: 123, upload_expires_at: 1.second.ago)
      as_user(@admin) { post complete_path(@resource), headers: headers }
      assert_response :unprocessable_entity
    end
    assert_empty @copied
  end

  private

  def user(name, role)
    User.create!(clerk_id: "resource_#{name}", email: "#{name}@resource.test", first_name: name, role: role)
  end

  def headers
    { "Authorization" => "Bearer test_token" }
  end

  def download_path(curriculum_id = @curriculum.id)
    "/api/v1/curricula/#{curriculum_id}/resources/#{@resource.id}/download"
  end

  def complete_path(resource)
    "/api/v1/curricula/#{@curriculum.id}/resources/#{resource.id}/complete"
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def with_storage
    originals = %i[configured? generate_presigned_post object_metadata copy_object delete_object generate_presigned_url].to_h { |name| [ name, S3Service.method(name) ] }
    signed, copied, test_instance = @signed, @copied, self
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_post) { |*_args, **_kwargs| Struct.new(:url, :fields).new("https://storage.test/upload", { "key" => "fixture" }) }
    S3Service.define_singleton_method(:object_metadata) { |_key| test_instance.instance_variable_get(:@metadata) }
    S3Service.define_singleton_method(:copy_object) { |source, destination, etag:| copied << [ source, destination, etag ] }
    S3Service.define_singleton_method(:delete_object) { |_key| true }
    S3Service.define_singleton_method(:generate_presigned_url) { |key, expires_in:| signed << [ key, expires_in ]; "https://storage.test/download" }
    yield
  ensure
    originals.each { |name, implementation| S3Service.define_singleton_method(name, implementation) }
  end
end
