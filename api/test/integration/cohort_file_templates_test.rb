require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# New cohorts start with their curriculum's template files; staff import
# later templates or another cohort's class files; items marked auto-copy
# reach every active learner's folder, including learners who join later.
class CohortFileTemplatesTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  setup do
    @plan = @curriculum.curriculum_files.create!(kind: "doc", title: "Job Search Plan", folder: "Career & Job Search", doc_content: "- [ ] Apply",
      auto_copy_to_students: true, ready: true, uploaded_by: @admin)
    @schedule = @curriculum.curriculum_files.create!(kind: "link", title: "Schedule", external_url: "https://docs.google.com/spreadsheets/d/demo/edit", ready: true)
    @facilitation = @curriculum.curriculum_files.create!(kind: "doc", title: "Facilitation Guide", folder: "Instructor Notes", visibility: "staff_only", doc_content: "Notes", ready: true)
    token = SecureRandom.uuid
    @deck = @curriculum.curriculum_files.create!(kind: "file", title: "Deck", filename: "deck.pdf", content_type: "application/pdf", file_size: 123,
      s3_key: "curriculum_files/curriculum_#{@curriculum.id}/#{token}/deck.pdf", upload_key: "curriculum_file_uploads/curriculum_#{@curriculum.id}/#{token}/deck.pdf",
      upload_expires_at: Time.current, ready: true)
  end

  test "a new cohort starts with every ready template without storage, skipping uploads and copying auto-copy items later" do
    assert_not S3Service.configured?
    as_user(@admin) { post "/api/v1/cohorts", params: { name: "Spring", curriculum_id: @curriculum.id, start_date: Date.current }, headers: headers, as: :json }
    assert_response :created
    cohort = Cohort.find(response.parsed_body.dig("cohort", "id"))
    files = cohort.cohort_files.class_files.order(:title)
    assert_equal [ "Facilitation Guide", "Job Search Plan", "Schedule" ], files.map(&:title)
    assert_equal [ @facilitation.id, @plan.id, @schedule.id ], files.map(&:source_curriculum_file_id)
    assert_equal [ "staff_only", "students", "students" ], files.map(&:visibility)
    assert_equal [ false, true, false ], files.map(&:auto_copy_to_students)

    student = user("spring_student", :student)
    Enrollment.create!(user: student, cohort: cohort)
    copy = cohort.cohort_files.find_by!(student_id: student.id)
    assert_equal [ "Job Search Plan", "- [ ] Apply", files.second.id ], [ copy.title, copy.doc_content, copy.source_file_id ]

    with_storage do
      as_user(@admin) { post "/api/v1/cohorts/#{cohort.id}/files/import_curriculum", headers: headers }
    end
    assert_response :success
    assert_equal [ 1, 3, 0, 0 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count", "auto_copied_count")
    deck = cohort.cohort_files.find_by!(source_curriculum_file_id: @deck.id)
    assert_match %r{\Acohort_files/cohort_#{cohort.id}/shared/}, deck.s3_key
    assert_equal [ [ @deck.s3_key, deck.s3_key, nil ] ], @copied
  end

  test "a cohort is created even when seeding fails" do
    original = CohortFileImport.method(:from_curriculum)
    CohortFileImport.define_singleton_method(:from_curriculum) { |*_args, **_kwargs| raise Aws::S3::Errors::ServiceError.new(nil, "down") }
    as_user(@admin) { post "/api/v1/cohorts", params: { name: "Resilient", curriculum_id: @curriculum.id, start_date: Date.current }, headers: headers, as: :json }
    assert_response :created
  ensure
    CohortFileImport.define_singleton_method(:from_curriculum, original)
  end

  test "import from curriculum is idempotent and copies new auto-copy items to active learners only" do
    @enrollment.update!(status: :paused)
    with_storage do
      as_user(@teacher) { post import_path, headers: headers }
      assert_response :success
      assert_equal [ 4, 0, 0, 1 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count", "auto_copied_count")
      assert_equal [ @classmate.id ], @cohort.cohort_files.where.not(student_id: nil).where(title: "Job Search Plan").pluck(:student_id)

      as_user(@teacher) { post import_path, headers: headers }
      assert_equal [ 0, 4, 0, 0 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count", "auto_copied_count")
    end
    assert_equal 4, @cohort.cohort_files.class_files.where.not(source_curriculum_file_id: nil).count
    as_user(@student) { post import_path, headers: headers }
    assert_response :forbidden
  end

  test "the database keeps one import of a template per cohort" do
    @cohort.cohort_files.create!(kind: "link", title: "Schedule", external_url: @schedule.external_url, source_curriculum_file: @schedule, ready: true)
    assert_raises(ActiveRecord::RecordNotUnique) do
      @cohort.cohort_files.create!(kind: "link", title: "Schedule", external_url: @schedule.external_url, source_curriculum_file: @schedule, ready: true)
    end
  end

  test "an upload whose import loses a race is skipped and its copied object removed" do
    with_storage do
      deleted = []
      record_external_calls(S3Service, :delete_object, returns: ->(key) { deleted << key; true }) do
        record_external_calls(S3Service, :copy_object, returns: lambda { |_source, destination, **_kwargs|
          # Another import of the same template commits while this copy runs.
          token = SecureRandom.uuid
          @cohort.cohort_files.create!(kind: "file", title: "Deck", filename: "deck.pdf", content_type: "application/pdf", file_size: 123, source_curriculum_file: @deck,
            s3_key: "cohort_files/cohort_#{@cohort.id}/shared/#{token}/deck.pdf", upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/deck.pdf", upload_expires_at: Time.current, ready: true)
          @raced_key = destination
        }) do
          result = CohortFileImport.from_curriculum(@cohort, actor: @admin)
          assert_not_includes result.files.map(&:source_curriculum_file_id), @deck.id
        end
      end
      assert_includes deleted, @raced_key
      assert_equal 1, @cohort.cohort_files.where(source_curriculum_file_id: @deck.id).count
    end
  end

  test "an upload storage can't copy is skipped and the rest of the import still lands" do
    with_storage do
      record_external_calls(S3Service, :copy_object, returns: ->(*_args, **_kwargs) { raise Seahorse::Client::NetworkingError, StandardError.new("reset") }) do
        as_user(@teacher) { post "#{files_path}/import_curriculum", headers: headers }
      end
      assert_response :success
      assert_equal [ 3, 0, 1 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count"), "a storage failure is a failure, not a duplicate"
      assert_not @cohort.cohort_files.exists?(source_curriculum_file_id: @deck.id)
      as_user(@teacher) { post "#{files_path}/import_curriculum", headers: headers }
      assert_equal [ 1, 3, 0 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count"), "the failed upload imports on the next try"
    end
  end

  test "without storage, uploads count as failed rather than already imported" do
    assert_not S3Service.configured?
    as_user(@teacher) { post "#{files_path}/import_curriculum", headers: headers }
    assert_equal [ 3, 0, 1 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count")
    as_user(@teacher) { post "#{files_path}/import_curriculum", headers: headers }
    assert_equal [ 0, 3, 1 ], response.parsed_body.values_at("imported_count", "skipped_count", "failed_count")
  end

  test "an automatic copy whose item stops being shared or auto-copied while storage copies is not inserted, and its copy is removed" do
    with_storage do
      file = ready_file(title: "Deck", filename: "deck.pdf")
      file.update!(auto_copy_to_students: true)
      late = user("late_withdraw", :student)
      # Active without running its own enrollment hook.
      enrollment = Enrollment.create!(user: late, cohort: @cohort, status: :paused)
      enrollment.update_columns(status: Enrollment.statuses.fetch("active"), paused_at: nil)
      [ ->(source) { source.update_columns(auto_copy_to_students: false) },
        ->(source) { source.update_columns(auto_copy_to_students: false, visibility: "staff_only") },
        ->(source) { source.update_columns(ready: false) } ].each_with_index do |withdraw, index|
        file.update_columns(auto_copy_to_students: true, visibility: "students", ready: true)
        deleted = []
        record_external_calls(S3Service, :delete_object, returns: ->(key) { deleted << key; true }) do
          record_external_calls(S3Service, :copy_object, returns: ->(_source, destination, **_kwargs) { withdraw.call(file); @raced_key = destination }) do
            assert_equal 0, CohortFileCopy.auto_copy_for_enrollment(enrollment.reload), index
          end
        end
        assert_not @cohort.cohort_files.exists?(student_id: late.id, source_file_id: file.id), index
        assert_includes deleted, @raced_key, index
      end
    end
  end

  test "a manual copy rechecks that the class item is still shared once the learner's enrollment is locked" do
    doc = @cohort.cohort_files.create!(kind: "doc", title: "Shared then staged", doc_content: "x", ready: true)
    staged_after_check = Module.new do
      define_method(:insert) do |source, enrollment_id, copy, auto|
        CohortFile.where(id: source.id).update_all(visibility: "staff_only")
        super(source, enrollment_id, copy, auto)
      end
    end
    CohortFileCopy.singleton_class.prepend(staged_after_check)
    result = CohortFileCopy.to_active_students(doc, actor: @admin)
    assert_empty result.copies
    assert_not @cohort.cohort_files.exists?(source_file_id: doc.id)
  ensure
    staged_after_check&.send(:remove_method, :insert)
  end

  test "copy from another cohort needs access to both, refuses the same cohort and never copies student folders" do
    source = @other_cohort
    source.cohort_files.create!(kind: "doc", title: "Portfolio Checklist", doc_content: "- [ ] Domain", auto_copy_to_students: true, ready: true)
    source.cohort_files.create!(kind: "link", title: "Private link", external_url: "https://github.com/outsider", student: @outsider, ready: true)
    path = "#{files_path}/copy_from_cohort"

    as_user(@teacher) { post path, params: { source_cohort_id: source.id }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@admin) { post path, params: { source_cohort_id: @cohort.id }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@admin) { post path, params: { source_cohort_id: 0 }, headers: headers, as: :json }
    assert_response :unprocessable_entity

    as_user(@admin) { post path, params: { source_cohort_id: source.id }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ 1, 0, 0, 2 ], response.parsed_body.values_at("copied_count", "skipped_count", "failed_count", "auto_copied_count")
    assert_equal [ "Portfolio Checklist" ], response.parsed_body.fetch("files").map { |file| file["title"] }
    assert_not @cohort.cohort_files.exists?(title: "Private link")
    assert_equal 2, @cohort.cohort_files.where(title: "Portfolio Checklist").where.not(student_id: nil).count

    as_user(@admin) { post path, params: { source_cohort_id: source.id }, headers: headers, as: :json }
    assert_equal [ 0, 1, 0, 0 ], response.parsed_body.values_at("copied_count", "skipped_count", "failed_count", "auto_copied_count")
  end

  test "a copied item that came from this cohort's own template is never imported again" do
    imported = CohortFileImport.from_curriculum(@other_cohort, actor: @admin)
    assert_equal 3, imported.files.size
    imported = -> { @cohort.cohort_files.class_files.where.not(source_curriculum_file_id: nil) }
    CohortFileImport.from_cohort(@cohort, @other_cohort, actor: @admin)
    assert_equal 3, imported.call.count
    assert_equal 3, @cohort.cohort_files.class_files.where.not(source_cohort_file_id: nil).count
    assert_equal 0, CohortFileImport.from_curriculum(@cohort, actor: @admin).files.size, "uploads are skipped without storage"
    assert_equal 3, imported.call.count
  end

  test "turning on auto-copy reaches active learners once, alongside manual copies; it is refused on staged and student items" do
    doc = @cohort.cohort_files.create!(kind: "doc", title: "Portfolio Launch", doc_content: "- [ ] Ship", ready: true, uploaded_by: @admin)
    as_user(@teacher) { post copy_path(doc), headers: headers }
    assert_equal 2, response.parsed_body.fetch("copied_count")

    as_user(@teacher) { patch file_path(doc), params: { auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ true, 0 ], [ response.parsed_body.dig("file", "auto_copy_to_students"), response.parsed_body.fetch("auto_copied_count") ]
    assert_equal 2, @cohort.cohort_files.where(source_file_id: doc.id).count

    newcomer = user("newcomer", :student)
    Enrollment.create!(user: newcomer, cohort: @cohort)
    assert_equal 1, @cohort.cohort_files.where(source_file_id: doc.id, student_id: newcomer.id).count
    as_user(@teacher) { post copy_path(doc), headers: headers }
    assert_equal [ 0, 3 ], response.parsed_body.values_at("copied_count", "skipped_count")

    as_user(@teacher) { patch file_path(@staged), params: { auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { patch file_path(@from_staff), params: { auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { patch file_path(doc), params: { visibility: "staff_only" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { patch file_path(doc), params: { visibility: "staff_only", auto_copy_to_students: false }, headers: headers, as: :json }
    assert_response :success
    as_user(@student) { patch file_path(@mine), params: { auto_copy_to_students: true }, headers: headers, as: :json }
    assert_not @mine.reload.auto_copy_to_students?
  end

  test "an enrollment made active again gets missing auto-copy items; paused, expired and storage-less cases are skipped without failing" do
    doc = @cohort.cohort_files.create!(kind: "doc", title: "Plan", doc_content: "x", auto_copy_to_students: true, ready: true)
    file = ready_file(title: "Deck", filename: "deck.pdf")
    file.update!(auto_copy_to_students: true)
    late = user("late", :student)
    enrollment = Enrollment.create!(user: late, cohort: @cohort, status: :paused)
    assert_not @cohort.cohort_files.exists?(student_id: late.id)

    enrollment.update!(status: :active)
    assert_equal [ doc.id ], @cohort.cohort_files.where(student_id: late.id).pluck(:source_file_id), "uploads wait for storage"

    with_storage do
      enrollment.update!(access_expires_at: 1.week.from_now)
      assert_equal [ doc.id, file.id ].sort, @cohort.cohort_files.where(student_id: late.id).pluck(:source_file_id).sort
      expired = Enrollment.create!(user: user("expired", :student), cohort: @cohort, access_expires_at: 1.minute.ago)
      assert_not @cohort.cohort_files.exists?(student_id: expired.user_id)
    end

    originals = %i[configured? copy_object].to_h { |name| [ name, S3Service.method(name) ] }
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:copy_object) { |*_args, **_kwargs| raise Aws::S3::Errors::ServiceError.new(nil, "down") }
    assert_difference -> { Enrollment.count }, 1 do
      Enrollment.create!(user: user("storm", :student), cohort: @cohort)
    end
  ensure
    originals&.each { |name, implementation| S3Service.define_singleton_method(name, implementation) }
  end

  test "the database refuses auto-copy on staged and student items" do
    assert_raises(ActiveRecord::StatementInvalid) { @staged.update_columns(auto_copy_to_students: true) }
    assert_raises(ActiveRecord::StatementInvalid) { @mine.update_columns(auto_copy_to_students: true) }
  end

  test "a cohort's own copy of the curriculum keeps the templates and its imports point at them" do
    CohortFileImport.from_curriculum(@cohort, actor: @admin)
    result = CurriculumCopyForCohort.new(cohort: @cohort, user: @admin, source_curriculum_id: @curriculum.id).copy!
    copy = result.copy.copy_curriculum
    assert_equal @curriculum.curriculum_files.ready.count, copy.curriculum_files.count
    imports = @cohort.cohort_files.class_files.where.not(source_curriculum_file_id: nil).pluck(:source_curriculum_file_id)
    assert_equal 3, imports.size
    assert_empty imports - copy.curriculum_files.pluck(:id), "imports point at the copy's templates"
    copied_deck = copy.curriculum_files.find_by!(kind: "file")
    assert_equal @deck.s3_key, copied_deck.s3_key
    assert_not_equal @deck.upload_key, copied_deck.upload_key
    assert_equal 0, CohortFileImport.from_curriculum(@cohort.reload, actor: @admin).files.size
    @deck.destroy!
    with_storage { assert_equal :referenced, S3ObjectCleanup.delete_unreferenced(@deck.s3_key), "the copy still names the object" }
  end

  private

  def import_path
    "#{files_path}/import_curriculum"
  end
end
