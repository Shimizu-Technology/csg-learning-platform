class CohortHomeProjection
  def initialize(cohort:, viewer:)
    @cohort = cohort
    @viewer = viewer
  end

  def call
    payload = {
      cohort: cohort_summary,
      permissions: permissions,
      upcoming_events: OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(@cohort), limit: 4),
      recent_announcements: recent_announcements
    }

    if @viewer.staff?
      payload.merge!(staff_summary)
    else
      payload[:own_progress_percentage] = progress_for(@viewer.id, assigned_block_ids_for(@viewer.id))
    end

    payload
  end

  private

  def cohort_summary
    {
      id: @cohort.id,
      name: @cohort.name,
      status: @cohort.status,
      cohort_type: @cohort.cohort_type,
      curriculum_name: @cohort.curriculum.name,
      start_date: @cohort.start_date,
      end_date: @cohort.end_date,
      workspace_id: @cohort.workspace&.id
    }
  end

  def permissions
    teacher = @viewer.can_teach_cohort?(@cohort)
    {
      can_manage_roster: @viewer.admin?,
      can_manage_schedule: teacher,
      can_manage_learning_schedule: @viewer.admin?,
      can_grade: teacher,
      can_announce: teacher
    }
  end

  def recent_announcements
    Announcement.visible_for(@viewer)
      .where(audience: :cohort, cohort_id: @cohort.id)
      .ordered.limit(3)
      .map { |announcement|
        {
          id: announcement.id,
          title: announcement.title,
          published_at: announcement.published_at,
          pinned: announcement.pinned
        }
      }
  end

  def staff_summary
    enrollments = @cohort.enrollments.includes(:user, :module_assignments).joins(:user).merge(User.not_archived).to_a
    active = enrollments.select(&:active?)
    attention = AttentionProjection.new(enrollment_scope: Enrollment.where(id: enrollments.map(&:id))).call
    students = attention[:enrollments]
    active_students = students.select { |row| active.any? { |enrollment| enrollment.id == row[:enrollment_id] } }

    {
      attention: attention.except(:enrollments),
      counts: {
        invited: active.count { |enrollment| enrollment.joined_at.nil? },
        joined: active.count { |enrollment| enrollment.joined_at.present? },
        active_students: active.size,
        ungraded: active_students.sum { |student| student[:ungraded_count] },
        redos: active_students.sum { |student| student[:redo_count] },
        open_help: @cohort.help_requests.active_queue.count,
        # Learners in a running cohort with nothing assigned see an empty course.
        without_modules: @cohort.active? ? active_students.count { |row| row[:total_blocks].zero? } : 0
      },
      students: students
    }
  end

  def assigned_block_ids_for(user_id)
    enrollment = @cohort.enrollments.find_by(user_id: user_id)
    return [] unless enrollment

    AssignedLearningContent.new(enrollment).completion_block_ids
  end

  def progress_for(user_id, block_ids)
    return 0 if block_ids.empty?

    completed = Progress.completed.where(enrollment_id: @cohort.enrollments.where(user_id: user_id).select(:id), content_block_id: block_ids).count
    (completed.to_f / block_ids.size * 100).round(1)
  end
end
