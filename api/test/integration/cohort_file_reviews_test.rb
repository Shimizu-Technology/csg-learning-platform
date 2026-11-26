require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# The review loop on student-folder items: review status, comments and their notifications.
class CohortFileReviewsTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  test "a student sends their own item for review, staff are notified and see it counted, and only staff mark it reviewed" do
    as_user(@student) { patch review_path(@from_staff), params: { review_status: "needs_review" }, headers: headers, as: :json }
    assert_response :success
    assert_equal "needs_review", response.parsed_body.dig("file", "review_status")
    notified = Notification.where(notifiable: @from_staff, notification_type: :cohort_file)
    assert_equal [ @admin.id, @teacher.id ].sort, notified.pluck(:user_id).sort
    notice = notified.find_by!(user: @teacher)
    assert_equal "/admin/cohorts/#{@cohort.id}?tab=files&student=#{@student.id}&file=#{@from_staff.id}", notice.path
    assert_equal [ "File ready for review", "student asked for a review.", @student.id ], [ notice.title, notice.body, notice.actor_id ]
    assert_not Notification.exists?(user: @outside_teacher)

    as_user(@teacher) { get files_path, headers: headers }
    folder = response.parsed_body.fetch("student_folders").find { |entry| entry["student_id"] == @student.id }
    assert_equal 1, folder.fetch("needs_review_count")
    assert_equal 0, response.parsed_body.fetch("student_folders").find { |entry| entry["student_id"] == @classmate.id }.fetch("needs_review_count")

    as_user(@student) { patch review_path(@mine), params: { review_status: "reviewed" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { patch review_path(@slides), params: { review_status: "needs_review" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@student) { patch review_path(@classmate_file), params: { review_status: "needs_review" }, headers: headers, as: :json }
    assert_response :not_found
    as_user(@student) { patch review_path(@staff_only_private), params: { review_status: "needs_review" }, headers: headers, as: :json }
    assert_response :not_found
    as_user(@student) { patch review_path(@mine), params: { review_status: "approved" }, headers: headers, as: :json }
    assert_response :unprocessable_entity

    as_user(@teacher) { patch review_path(@from_staff), params: { review_status: "reviewed" }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "reviewed", "teacher" ], response.parsed_body.fetch("file").values_at("review_status", "reviewed_by_name")
    assert_not_nil response.parsed_body.dig("file", "reviewed_at")
    student_notice = Notification.find_by!(notifiable: @from_staff, user: @student)
    assert_equal [ "/resources?cohort_id=#{@cohort.id}&file=#{@from_staff.id}", "File reviewed", "cohort_file" ],
      [ student_notice.path, student_notice.title, student_notice.notification_type ]
    as_user(@teacher) { patch review_path(@slides), params: { review_status: "reviewed" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { patch review_path(@staff_only_private), params: { review_status: "reviewed" }, headers: headers, as: :json }
    assert_response :unprocessable_entity

    # A student withdrawing or re-sending clears the review.
    as_user(@student) { patch review_path(@from_staff), params: { review_status: "none" }, headers: headers, as: :json }
    assert_equal [ "none", nil, nil ], response.parsed_body.fetch("file").values_at("review_status", "reviewed_by_name", "reviewed_at")
  end

  test "a new version of an item waiting for review notifies staff again" do
    @mine.update!(review_status: "needs_review")
    with_storage do
      as_user(@student) { post versions_path(@mine), params: version_params(filename: "resume-v2.pdf"), headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@student) { post complete_version_path(@mine, version), headers: headers }
      assert_response :success
    end
    notice = Notification.find_by!(notifiable: @mine, user: @teacher)
    assert_equal [ "Updated file ready for review", "student uploaded a new version for review." ], [ notice.title, notice.body ]
  end

  test "comments thread between the student and staff, notify the other side, and stay private to that folder" do
    as_user(@student) { post comments_path(@mine), params: { body: "  Can you check my summary?  " }, headers: headers, as: :json }
    assert_response :created
    comment = response.parsed_body.fetch("comment")
    assert_equal [ "Can you check my summary?", "student", "student", true ], comment.values_at("body", "author_name", "author_role", "can_delete")
    staff_notice = Notification.find_by!(notifiable: @mine, user: @teacher)
    # No file title or comment text is copied into the notice.
    assert_equal [ "New file comment", "student commented on a file in their folder." ], [ staff_notice.title, staff_notice.body ]

    as_user(@teacher) { post comments_path(@mine), params: { body: "Looks strong. Tighten the second bullet." }, headers: headers, as: :json }
    assert_response :created
    staff_comment = CohortFileComment.find(response.parsed_body.dig("comment", "id"))
    assert_equal [ "New file comment", "A new comment was added in your files." ], Notification.find_by!(notifiable: @mine, user: @student).values_at(:title, :body)
    assert_not Notification.exists?(notifiable: @mine, user: @classmate)

    as_user(@student) { get comments_path(@mine), headers: headers }
    assert_response :success
    body = response.parsed_body
    assert_equal [ "Can you check my summary?", "Looks strong. Tighten the second bullet." ], body.fetch("comments").pluck("body")
    assert_equal [ true, false ], body.fetch("comments").pluck("can_delete")
    assert_equal true, body.fetch("can_comment")
    as_user(@student) { get files_path, headers: headers }
    assert_equal 2, response.parsed_body.fetch("my_files").find { |file| file["id"] == @mine.id }.fetch("comment_count")
    as_user(@teacher) { get files_path, headers: headers }
    staff_row = response.parsed_body.fetch("student_folders").find { |entry| entry["student_id"] == @student.id }.fetch("files").find { |file| file["id"] == @mine.id }
    assert_equal 2, staff_row.fetch("comment_count")

    as_user(@classmate) { get comments_path(@mine), headers: headers }
    assert_response :not_found
    as_user(@classmate) { post comments_path(@mine), params: { body: "Hi" }, headers: headers, as: :json }
    assert_response :not_found
    as_user(@outside_teacher) { get comments_path(@mine), headers: headers }
    assert_response :forbidden
    as_user(@teacher) { get comments_path(@slides), headers: headers }
    assert_response :unprocessable_entity
    as_user(@teacher) { post comments_path(@slides), params: { body: "Class thread" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    [ "", "   ", "a" * (CohortFileComment::MAX_BODY_LENGTH + 1), "nul \u0000 inside" ].each do |text|
      as_user(@student) { post comments_path(@mine), params: { body: text }, headers: headers, as: :json }
      assert_response :unprocessable_entity
    end

    as_user(@student) { delete "#{comments_path(@mine)}/#{staff_comment.id}", headers: headers }
    assert_response :forbidden
    own = @mine.comments.find_by!(user: @student)
    as_user(@student) { delete "#{comments_path(@mine)}/#{own.id}", headers: headers }
    assert_response :no_content
    as_user(@teacher) { delete "#{comments_path(@mine)}/#{staff_comment.id}", headers: headers }
    assert_response :no_content
    assert_equal 0, @mine.comments.count
    other = @classmate_file.comments.create!(user: @classmate, body: "Theirs")
    as_user(@teacher) { delete "#{comments_path(@mine)}/#{other.id}", headers: headers }
    assert_response :not_found
  end

  test "a failed notification never undoes the comment or review change" do
    original = NotificationDeliveryService.method(:cohort_file_commented)
    NotificationDeliveryService.define_singleton_method(:cohort_file_commented) { |_comment| raise ActiveRecord::StatementInvalid, "notifications down" }
    begin
      as_user(@student) { post comments_path(@mine), params: { body: "Saved anyway" }, headers: headers, as: :json }
    ensure
      NotificationDeliveryService.define_singleton_method(:cohort_file_commented, original)
    end
    assert_response :created
    assert_equal [ "Saved anyway" ], @mine.comments.pluck(:body)

    record_external_calls(NotificationDeliveryService, :cohort_file_review_requested, returns: ->(*) { raise "down" }) do |calls|
      as_user(@student) { patch review_path(@mine), params: { review_status: "needs_review" }, headers: headers, as: :json }
      assert_sent_after_commit(calls, "review notification")
    end
    assert_response :success
    assert_equal "needs_review", @mine.reload.review_status
  end

  test "file notifications are visible only to people who can still open the file" do
    as_user(@student) { patch review_path(@mine), params: { review_status: "needs_review" }, headers: headers, as: :json }
    as_user(@teacher) { post comments_path(@mine), params: { body: "On it" }, headers: headers, as: :json }
    assert Notification.visible_to(@student).exists?(notifiable: @mine)
    assert Notification.visible_to(@teacher).exists?(notifiable: @mine)

    # A notice about another student's file, or a staff-only one, never shows to this student.
    stray = Notification.create!(user: @student, notifiable: @classmate_file, notification_type: :cohort_file, title: "Stray", path: "/resources")
    hidden = Notification.create!(user: @student, notifiable: @staff_only_private, notification_type: :cohort_file, title: "Staff only", path: "/resources")
    assert_not Notification.visible_to(@student).exists?(id: [ stray.id, hidden.id ])
    elsewhere = Notification.create!(user: @outside_teacher, notifiable: @mine, notification_type: :cohort_file, title: "Elsewhere", path: "/admin")
    assert_not Notification.visible_to(@outside_teacher).exists?(id: elsewhere.id)

    @enrollment.update_columns(status: Enrollment.statuses.fetch("dropped"))
    assert_not Notification.visible_to(@student).exists?(notifiable: @mine)
    @enrollment.update_columns(status: Enrollment.statuses.fetch("active"))
    as_user(@student) { delete file_path(@mine), headers: headers }
    assert_response :no_content
    assert_not Notification.exists?(notifiable_type: "CohortFile", notifiable_id: @mine.id)
  end

  test "file notifications list with the path to the item and no record descriptor" do
    as_user(@student) { patch review_path(@mine), params: { review_status: "needs_review" }, headers: headers, as: :json }
    as_user(@teacher) { get "/api/v1/notifications", headers: headers }
    assert_response :success
    entry = response.parsed_body.fetch("notifications").find { |item| item.dig("notifiable", "type") == "CohortFile" }
    assert_equal [ "cohort_file", "/admin/cohorts/#{@cohort.id}?tab=files&student=#{@student.id}&file=#{@mine.id}", nil, true ],
      entry.values_at("notification_type", "destination_path", "destination", "target_available")
  end

  test "paused students are not notified about staff comments they could not read" do
    @enrollment.update!(status: :paused)
    as_user(@teacher) { post comments_path(@mine), params: { body: "After pause" }, headers: headers, as: :json }
    assert_response :created
    assert_not Notification.exists?(notifiable: @mine, user: @student)
  end

  private

  def review_path(file)
    "#{file_path(file)}/review"
  end

  def comments_path(file)
    "#{file_path(file)}/comments"
  end
end
