require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require "timeout"

# Every grant-checked lesson write re-checks access inside its transaction
# (LessonEditAccess, lock: true). Here a second connection revokes the
# instructor's grant, or attaches another cohort to the curriculum, and
# commits right after the request's early before_action check passed. The
# write must then be refused and leave nothing behind; without the
# in-transaction re-check each of these requests would succeed.
class LessonEditRecheckConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup

  # Runs `callback` (when set) once the early check has passed.
  module AfterEarlyCheck
    mattr_accessor :callback

    def require_lesson_edit_access!(curriculum)
      result = super
      unless performed?
        callback = AfterEarlyCheck.callback
        AfterEarlyCheck.callback = nil
        callback&.call
      end
      result
    end
  end

  [ Api::V1::ContentBlocksController, Api::V1::LessonBlockEditorsController, Api::V1::LessonsController,
    Api::V1::ObjectiveAlignmentsController, Api::V1::LearningObjectivesController, Api::V1::RubricsController ].each do |controller|
    controller.prepend(AfterEarlyCheck) unless controller.ancestors.include?(AfterEarlyCheck)
  end

  WRITES = {
    "legacy block create" => ->(t) { t.post "/api/v1/lessons/#{t.lesson.id}/content_blocks", params: { block_type: "text", body: "New", position: 5 }, headers: t.auth_headers, as: :json },
    "legacy block update" => ->(t) { t.patch "/api/v1/content_blocks/#{t.block.id}", params: { body: "Changed" }, headers: t.auth_headers, as: :json },
    "legacy block delete" => ->(t) { t.delete "/api/v1/content_blocks/#{t.block.id}", headers: t.auth_headers },
    "block editor" => ->(t) {
      t.put "/api/v1/lessons/#{t.lesson.id}/block_editor", headers: t.auth_headers, as: :json, params: {
        lesson: { base_updated_at: t.lesson.updated_at.iso8601(6), title: "Changed",
                  blocks: [ { id: t.block.id, block_type: "text", title: t.block.title, body: "Changed" } ] }
      }
    },
    "mobile editor" => ->(t) { t.patch "/api/v1/lessons/#{t.lesson.id}/editor", params: { editor: { title: "Changed", base_updated_at: t.lesson.updated_at.iso8601(6) } }, headers: t.auth_headers, as: :json },
    "objective alignments" => ->(t) { t.patch "/api/v1/lessons/#{t.lesson.id}/objective_alignments", params: { alignments: [ { learning_objective_id: t.objective.id } ] }, headers: t.auth_headers, as: :json },
    "new objective aligned to the lesson" => ->(t) {
      t.post "/api/v1/learning_objectives", headers: t.auth_headers, as: :json,
             params: { learning_objective: { curriculum_id: t.curriculum.id, code: "RACE.2", title: "Loop", success_criteria: "I can loop." }, lesson_id: t.lesson.id }
    },
    "new rubric" => ->(t) { t.post "/api/v1/rubrics", params: { rubric: { curriculum_id: t.curriculum.id, title: "Race rubric", criteria: [ { title: "Works", description: "It runs." } ] } }, headers: t.auth_headers, as: :json }
  }.freeze

  CHANGES = {
    "a revoke" => [ "lesson_editing_not_granted", ->(t) { CohortInstructorAssignment.find(t.assignment.id).set_lesson_editing!(false, by: t.admin) } ],
    "another cohort joining the curriculum" => [ "curriculum_shared", ->(t) { t.joined_cohorts << Cohort.create!(name: "Joined #{SecureRandom.hex(3)}", curriculum: t.curriculum, start_date: Date.current, status: :upcoming) } ]
  }.freeze

  attr_reader :curriculum, :lesson, :block, :objective, :assignment, :admin, :joined_cohorts

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Recheck race #{slug}")
    @cohort = Cohort.create!(name: "Recheck class #{slug}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Before", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Why", body: "Before")
    @objective = LearningObjective.create!(curriculum: @curriculum, code: "RACE.1", title: "Branch", success_criteria: "I can branch.")
    @admin = User.create!(clerk_id: "recheck_admin_#{slug}", email: "recheck-admin-#{slug}@example.invalid", first_name: "Ada", last_name: "Admin", role: :admin)
    @instructor = User.create!(clerk_id: "recheck_instructor_#{slug}", email: "recheck-instructor-#{slug}@example.invalid", first_name: "Ian", last_name: "Instructor", role: :instructor)
    @assignment = CohortInstructorAssignment.create!(cohort: @cohort, user: @instructor)
    @assignment.set_lesson_editing!(true, by: @admin)
    @joined_cohorts = []
    @threads = []
  end

  teardown do
    AfterEarlyCheck.callback = nil
    finish_test_threads(@threads)
    ActivityEvent.where(subject_user_id: @instructor&.id).delete_all
    CohortInstructorAssignment.where(id: @assignment&.id).delete_all
    RubricCriterion.where(rubric_id: Rubric.where(curriculum_id: @curriculum&.id).select(:id)).delete_all
    Rubric.where(curriculum_id: @curriculum&.id).delete_all
    ObjectiveAlignment.where(learning_objective_id: LearningObjective.where(curriculum_id: @curriculum&.id).select(:id)).delete_all
    LearningObjective.where(curriculum_id: @curriculum&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: @module&.id).delete_all
    (@joined_cohorts.to_a + [ @cohort ]).compact.each { |cohort| Cohort.find_by(id: cohort.id)&.destroy! }
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@admin, @instructor)
  end

  CHANGES.each do |change_label, (code, change)|
    WRITES.each do |write_label, write|
      test "#{write_label}: #{change_label} committed after the early check is refused in the transaction" do
        before = snapshot
        AfterEarlyCheck.callback = lambda do
          @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { change.call(self) } }
          Timeout.timeout(30) { @threads.last.value }
        end

        as_instructor { write.call(self) }

        assert_nil AfterEarlyCheck.callback, "the second connection ran after the early check"
        assert_response :forbidden
        assert_equal code, response.parsed_body["code"]
        assert_equal before, snapshot, "nothing was written"
      end
    end
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  private

  def snapshot
    {
      lesson: Lesson.where(id: @lesson.id).pluck(:title, :updated_at),
      blocks: ContentBlock.where(lesson_id: @lesson.id).order(:id).pluck(:id, :body, :updated_at),
      alignments: ObjectiveAlignment.where(lesson_id: @lesson.id).pluck(:learning_objective_id),
      objectives: LearningObjective.where(curriculum_id: @curriculum.id).pluck(:code),
      rubrics: Rubric.where(curriculum_id: @curriculum.id).count
    }
  end

  def as_instructor
    payload = { "sub" => @instructor.clerk_id, "email" => @instructor.email, "first_name" => @instructor.first_name, "last_name" => @instructor.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
