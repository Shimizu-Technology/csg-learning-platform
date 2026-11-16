module Api
  module V1
    # GET /api/v1/team_members/:id: one staff person's record page (L-3.6), for admins.
    # Students are not team members, so their ids answer 404, the same as a missing id.
    class TeamMembersController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def show
        member = User.where(role: %i[instructor admin]).find(params[:id])
        assignments = member.cohort_instructor_assignments.includes(:cohort, :edit_granted_by)
          .sort_by { |assignment| [ cohort_rank(assignment.cohort), -assignment.cohort.start_date.jd, assignment.cohort_id ] }

        render json: {
          team_member: {
            id: member.id,
            email: member.email,
            first_name: member.first_name,
            last_name: member.last_name,
            full_name: member.full_name,
            role: member.role,
            avatar_url: member.avatar_url,
            github_username: member.github_username,
            last_sign_in_at: member.last_sign_in_at,
            archived_at: member.archived_at,
            invite_pending: member.invite_pending?,
            created_at: member.created_at,
            is_self: member.id == current_user.id,
            # Read-only here; editing access is changed on the cohort's Teaching team tab.
            teaching: assignments.map { |assignment| teaching_json(assignment) },
            message_cohort_id: message_cohort_id(member, assignments)
          }
        }
      end

      private

      # Running cohorts first, then upcoming, then finished.
      def cohort_rank(cohort)
        { "active" => 0, "upcoming" => 1, "completed" => 2, "archived" => 3 }.fetch(cohort.status, 4)
      end

      def teaching_json(assignment)
        cohort = assignment.cohort
        {
          cohort: { id: cohort.id, name: cohort.name, status: cohort.status, course_delivery: cohort.course_delivery, start_date: cohort.start_date },
          assigned_at: assignment.created_at,
          can_edit_lessons: assignment.can_edit_lessons,
          edit_granted_at: assignment.edit_granted_at,
          edit_granted_by: assignment.edit_granted_by && { id: assignment.edit_granted_by.id, full_name: assignment.edit_granted_by.full_name }
        }
      end

      # A cohort whose class workspace lets the viewer message this person, by
      # the messaging rules in Workspace#available_users_scope: an instructor is
      # reachable in the live cohorts they teach, an admin in any live cohort.
      # Self-paced cohorts only reach their support instructor, so they are
      # skipped. Nil when there is none (or it's the viewer's own page); the
      # page then explains why there is no Message button.
      def message_cohort_id(member, assignments)
        return nil if member.id == current_user.id || member.archived?

        if member.admin?
          live_cohorts(Cohort.all).order(start_date: :desc, id: :desc).pick(:id)
        else
          live = assignments.map(&:cohort).select { |cohort| %w[active upcoming].include?(cohort.status) && !cohort.self_paced? }
          live_cohorts(Cohort.where(id: live.map(&:id))).order(start_date: :desc, id: :desc).pick(:id)
        end
      end

      def live_cohorts(scope)
        scope.where(status: %i[active upcoming]).where.not(course_delivery: "self_paced")
          .where.not(id: Workspace.archived.where.not(cohort_id: nil).select(:cohort_id))
      end
    end
  end
end
