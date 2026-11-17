require "test_helper"
require Rails.root.join("db/migrate/20261117040500_create_help_request_replies").to_s
require Rails.root.join("db/migrate/20261117050000_add_client_request_id_to_help_request_replies").to_s

# PR #282 fix round 1: requests answered before replies existed get their one
# response as a reply, exactly once, however often the migration runs.
class CreateHelpRequestRepliesTest < ActiveSupport::TestCase
  setup do
    curriculum = Curriculum.create!(name: "Backfill course")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Backfill cohort", start_date: Date.current, status: :active)
    @staff = User.create!(clerk_id: "backfill_staff", email: "backfill-staff@example.com", first_name: "Ina", last_name: "Teacher", role: :admin)
    @student = User.create!(clerk_id: "backfill_student", email: "backfill-student@example.com", role: :student)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "copies each existing response once, by its responder at its time, and replays safely" do
    resolved_at = Time.utc(2026, 10, 20, 9, 30)
    answered = request(context_id: 1, status: :resolved, owner: @staff, staff_response: "Check the loop.", acknowledged_at: resolved_at - 1.hour, resolved_at: resolved_at)
    open = request(context_id: 2)
    blank = request(context_id: 3, status: :acknowledged, owner: @staff, acknowledged_at: resolved_at)
    blank.update_columns(staff_response: "   ")
    orphaned = request(context_id: 4, status: :resolved, owner: @staff, staff_response: "Owner left.", acknowledged_at: resolved_at, resolved_at: resolved_at)
    orphaned.update_columns(owner_id: nil)
    already = request(context_id: 5, status: :resolved, owner: @staff, staff_response: "Newer reply.", acknowledged_at: resolved_at, resolved_at: resolved_at)
    HelpRequestReply.create!(help_request: already, author: @staff, body: "Newer reply.", resolved_request: true)

    create = CreateHelpRequestReplies.new
    dedupe = AddClientRequestIdToHelpRequestReplies.new
    connection = HelpRequestReply.connection
    3.times do
      create.migrate(:up)
      dedupe.migrate(:up)
    end

    copied = HelpRequestReply.where(help_request: answered).to_a
    assert_equal 1, copied.size
    assert_equal [ @staff.id, "Check the loop.", true ], [ copied.first.author_id, copied.first.body, copied.first.resolved_request ]
    assert_equal resolved_at, copied.first.created_at
    assert_empty HelpRequestReply.where(help_request: [ open, blank, orphaned ])
    assert_equal 1, HelpRequestReply.where(help_request: already).count, "a request that already has replies is left alone"

    # Down and up again rebuilds the table and copies the responses once more.
    dedupe.migrate(:down)
    create.migrate(:down)
    refute connection.table_exists?(:help_request_replies)
    create.migrate(:up)
    create.migrate(:up)
    dedupe.migrate(:up)
    connection.schema_cache.clear!
    HelpRequestReply.reset_column_information
    assert_equal 1, HelpRequestReply.where(help_request: answered).count
    assert_equal 1, HelpRequestReply.where(help_request: already).count
    assert connection.index_exists?(:help_request_replies, [ :help_request_id, :author_id, :client_request_id ], unique: true)
  ensure
    HelpRequestReply.reset_column_information
    # Changing tables leaves prepared statements that point at the old ones (#283).
    ActiveRecord::Base.connection_pool.connections.each(&:clear_cache!)
  end

  private

  def request(context_id:, status: :open, **attributes)
    HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: context_id,
      context_label: "Lesson #{context_id}", context_path: "/lessons/#{context_id}", category: :concept, message: "Question #{context_id}", status: status, **attributes)
  end
end
