require "test_helper"

# A pending invite is hard deleted only when nothing but disposable per-user
# state points at it. Every other foreign key into users is history that must
# survive, so the invite is archived instead.
class UserHardDeleteTest < ActiveSupport::TestCase
  setup do
    @admin = User.create!(clerk_id: "clerk_hard_delete_admin", email: "hard-delete-admin@example.com", role: :admin)
    @student = User.create!(clerk_id: "clerk_hard_delete_student", email: "hard-delete-student@example.com", role: :student)
    @curriculum = Curriculum.create!(name: "Hard delete curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Hard delete cohort", start_date: Date.current, status: :active)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    @channel = Channel.create!(workspace: @cohort.workspace, cohort: @cohort, name: "Hard delete chat")
    @invite = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "hard-delete-invite@example.com", role: :instructor)
  end

  # Foreign keys into users that no User association covers. Each builder
  # leaves exactly one row pointing at the invite through that column.
  UNASSOCIATED_REFERENCES = {
    "announcements.edited_by_id" => lambda { |invite|
      Announcement.create!(title: "Edited", body: "Edited body", author: @admin, audience: :global, status: :published).update_column(:edited_by_id, invite.id)
    },
    "cohorts.support_instructor_id" => ->(invite) { @cohort.update_column(:support_instructor_id, invite.id) },
    "messages.pinned_by_id" => lambda { |invite|
      Message.create!(channel: @channel, author: @admin, body: "Pinned").update_column(:pinned_by_id, invite.id)
    },
    "content_reports.reviewed_by_id" => lambda { |invite|
      ContentReport.insert!({ reporter_id: @admin.id, reported_user_id: @student.id, reviewed_by_id: invite.id })
    },
    "data_deletion_requests.resolved_by_id" => lambda { |invite|
      DataDeletionRequest.insert!({ user_id: @student.id, resolved_by_id: invite.id })
    },
    "enrollment_restarts.student_id" => lambda { |invite|
      EnrollmentRestart.insert!({ cohort_id: @cohort.id, student_id: invite.id, performed_by_id: @admin.id })
    },
    "enrollment_restarts.performed_by_id" => lambda { |invite|
      EnrollmentRestart.insert!({ cohort_id: @cohort.id, student_id: @student.id, performed_by_id: invite.id })
    },
    "feature_switch_changes.actor_id" => ->(invite) { FeatureSwitchChange.insert!({ actor_id: invite.id, before: {}, after: {} }) },
    "learning_plan_revisions.author_id" => lambda { |invite|
      plan_id = LearningPlan.insert!({ enrollment_id: @enrollment.id, title: "Plan" }).first.fetch("id")
      LearningPlanRevision.insert!({ learning_plan_id: plan_id, author_id: invite.id, snapshot: {} })
    },
    "private_meeting_booking_events.actor_id" => lambda { |invite|
      slot_id = meeting_slot(instructor: @admin)
      booking_id = PrivateMeetingBooking.insert!({
        private_meeting_slot_id: slot_id, cohort_id: @cohort.id, enrollment_id: @enrollment.id, instructor_id: @admin.id,
        student_id: @student.id, week_number: 1, starts_at: 1.day.from_now, ends_at: 1.day.from_now + 1.hour
      }).first.fetch("id")
      PrivateMeetingBookingEvent.insert!({ private_meeting_booking_id: booking_id, actor_id: invite.id, action: "booked" })
    },
    "private_meeting_slots.instructor_id" => ->(invite) { meeting_slot(instructor: invite) }
  }.freeze

  test "every foreign key into users either deletes with the user or blocks hard deletion" do
    references = User.user_foreign_key_references
    # Independent of the production helper: every single-column FK into users.
    catalog = ActiveRecord::Base.connection.select_values(<<~SQL).sort
      SELECT DISTINCT child.relname || '.' || attribute.attname
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = constraint_row.conkey[1]
      WHERE constraint_row.contype = 'f' AND constraint_row.confrelid = 'users'::regclass
    SQL
    assert_equal catalog, references.sort
    assert_includes references, "cohorts.support_instructor_id"
    assert_empty User::HARD_DELETE_DISPOSABLE_REFERENCES - references, "stale disposable reference"

    User::HARD_DELETE_DISPOSABLE_REFERENCES.each do |reference|
      table, column = reference.split(".")
      association = User.reflect_on_all_associations(:has_many).find do |reflection|
        !reflection.through_reflection? && reflection.klass.table_name == table && reflection.foreign_key.to_s == column
      end
      assert association, "#{reference} is disposable but no User association removes its rows"
      assert_includes %i[destroy delete_all], association.options[:dependent], "#{reference} must be destroyed with the user"
    end

    assert_equal references - User::HARD_DELETE_DISPOSABLE_REFERENCES, User.hard_delete_blocking_references
    assert_empty UNASSOCIATED_REFERENCES.keys - User.hard_delete_blocking_references
  end

  test "a pending invite with only disposable state is deleted along with that state" do
    nonce = CableTokenNonce.create!(user: @invite, nonce: SecureRandom.hex(8), expires_at: 1.minute.from_now)
    assignment = @cohort.cohort_instructor_assignments.create!(user: @invite)
    notification = Notification.create!(user: @invite, notifiable: @cohort, notification_type: :system, title: "Welcome", path: "/")

    assert_empty @invite.hard_delete_blockers
    assert @invite.safe_to_hard_delete?
    @invite.destroy!

    assert_not User.exists?(@invite.id)
    assert_not CableTokenNonce.exists?(nonce.id)
    assert_not CohortInstructorAssignment.exists?(assignment.id)
    assert_not Notification.exists?(notification.id)
  end

  UNASSOCIATED_REFERENCES.each do |reference, build|
    test "a pending invite referenced by #{reference} is not safe to hard delete" do
      instance_exec(@invite, &build)

      assert_equal [ reference ], @invite.hard_delete_blockers
      assert_not @invite.safe_to_hard_delete?
    end
  end

  test "accepted users are never hard deleted" do
    assert_empty @admin.hard_delete_blockers
    assert_not @admin.safe_to_hard_delete?
  end

  test "authored messages block destroy and keep their author" do
    message = Message.create!(channel: @channel, author: @student, body: "Keep my author")

    assert_not @student.destroy
    assert_includes @student.errors.full_messages.join, "messages"
    assert User.exists?(@student.id)
    assert_equal @student.id, message.reload.author_id
  end

  test "authored announcements block destroy and keep their author" do
    announcement = Announcement.create!(title: "Notice", body: "Keep my author", author: @student, audience: :cohort, cohort: @cohort, status: :published)

    assert_not @student.destroy
    assert_includes @student.errors.full_messages.join, "announcements"
    assert User.exists?(@student.id)
    assert_equal @student.id, announcement.reload.author_id
    assert Enrollment.exists?(@enrollment.id), "the refused destroy rolls back earlier dependent deletes"
  end

  private

  def meeting_slot(instructor:)
    config = PrivateMeetingConfig.find_by(cohort: @cohort) ||
      PrivateMeetingConfig.insert!({ cohort_id: @cohort.id, instructor_id: @admin.id }).first.then { |row| PrivateMeetingConfig.find(row.fetch("id")) }
    PrivateMeetingSlot.insert!({
      private_meeting_config_id: config.id, instructor_id: instructor.id, starts_at: 2.days.from_now, ends_at: 2.days.from_now + 1.hour
    }).first.fetch("id")
  end
end
