require "test_helper"
require Rails.root.join("db/migrate/20261022020000_backfill_instructor_community_memberships")

class BackfillInstructorCommunityMembershipsTest < ActiveSupport::TestCase
  test "backfill preserves current accepted instructor access without elevating existing roles" do
    active = Workspace.create!(name: "Existing community", slug: "migration-active", workspace_type: :community)
    archived = Workspace.create!(name: "Archived community", slug: "migration-archived", workspace_type: :community, status: :archived)
    second = Workspace.create!(name: "Second community", slug: "migration-second", workspace_type: :community)
    teacher = create_user("teacher", :instructor)
    manager = create_user("manager", :instructor)
    archived_teacher = create_user("archived", :instructor, archived_at: Time.current)
    pending = create_user("pending", :instructor, clerk_id: "pending_migration")
    student = create_user("student", :student)
    admin = create_user("admin", :admin)
    existing = active.workspace_memberships.create!(user: manager, role: :manager)
    curriculum = Curriculum.create!(name: "Migration cohort curriculum")
    cohort = Cohort.create!(name: "Migration cohort", curriculum: curriculum, start_date: Date.current)
    migration = BackfillInstructorCommunityMemberships.new

    migration.up
    assert_no_difference("WorkspaceMembership.count") { migration.up }
    [ active, second ].each do |workspace|
      membership = workspace.workspace_memberships.find_by!(user: teacher)
      assert membership.member?
      assert membership.instructor_access_backfilled
      assert workspace.visible_to?(teacher)
      assert_includes Workspace.visible_for(teacher), workspace
      [ archived_teacher, pending, student, admin ].each do |excluded|
        refute workspace.workspace_memberships.exists?(user: excluded)
      end
    end
    assert existing.reload.manager?
    refute existing.instructor_access_backfilled
    assert_empty archived.workspace_memberships
    assert_empty cohort.workspace.workspace_memberships

    # New communities and future instructors do not receive implicit membership.
    future = Workspace.create!(name: "Future community", slug: "migration-future", workspace_type: :community)
    refute future.visible_to?(teacher)
    newcomer = create_user("newcomer", :instructor)
    refute active.visible_to?(newcomer)
    active.workspace_memberships.find_by!(user: teacher).destroy!
    refute active.visible_to?(teacher)

    promoted = second.workspace_memberships.find_by!(user: manager)
    promoted.update!(role: :manager)
    migration.down
    WorkspaceMembership.connection.clear_cache!
    assert existing.reload.manager?
    assert promoted.reload.manager?
    refute WorkspaceMembership.exists?(workspace: second, user: teacher)
    refute migration.column_exists?(:workspace_memberships, :instructor_access_backfilled)
    migration.up
    WorkspaceMembership.connection.clear_cache!
    WorkspaceMembership.reset_column_information
  ensure
    WorkspaceMembership.reset_column_information
  end

  private

  def create_user(name, role, **attributes)
    User.create!({ clerk_id: "backfill_#{name}", email: "backfill-#{name}@example.com", role: role }.merge(attributes))
  end
end
