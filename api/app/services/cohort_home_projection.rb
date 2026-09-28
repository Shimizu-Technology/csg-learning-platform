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
    user_ids = active.map(&:user_id)
    all_block_ids = @cohort.curriculum.modules.includes(lessons: :content_blocks)
      .flat_map { |curriculum_module| curriculum_module.lessons.flat_map(&:completion_block_ids) }.uniq
    latest_ids = Submission.where(enrollment_id: active.map(&:id), content_block_id: all_block_ids)
      .group(:user_id, :content_block_id).maximum(:id).values
    submissions_by_user = Submission.where(id: latest_ids).select(:id, :user_id, :grade).group_by(&:user_id)
    progress_by_user = Progress.completed.where(enrollment_id: active.map(&:id), content_block_id: all_block_ids)
      .pluck(:user_id, :content_block_id).group_by(&:first).transform_values { |rows| rows.map(&:last).to_set }
    module_block_ids = @cohort.curriculum.modules.includes(lessons: :content_blocks).to_h do |curriculum_module|
      [ curriculum_module.id, curriculum_module.lessons.flat_map(&:completion_block_ids) ]
    end

    students = enrollments.map do |enrollment|
      user = enrollment.user
      assigned_ids = enrollment.module_assignments.flat_map { |assignment| module_block_ids[assignment.module_id] || [] }.uniq
      submissions = submissions_by_user[user.id] || []
      completed_count = (progress_by_user[user.id] || Set.new).count { |block_id| assigned_ids.include?(block_id) }
      {
        user_id: user.id,
        enrollment_id: enrollment.id,
        full_name: user.full_name,
        email: user.email,
        status: enrollment.status,
        invited_at: enrollment.invited_at,
        joined_at: enrollment.joined_at,
        invite_delivery_status: user.invite_delivery_status,
        progress_percentage: assigned_ids.any? ? (completed_count.to_f / assigned_ids.size * 100).round(1) : 0,
        ungraded_count: submissions.count { |submission| submission.grade.nil? },
        redo_count: submissions.count { |submission| submission.grade == "R" },
        last_seen_at: user.last_seen_at
      }
    end

    {
      counts: {
        invited: active.count { |enrollment| enrollment.joined_at.nil? },
        joined: active.count { |enrollment| enrollment.joined_at.present? },
        active_students: active.size,
        ungraded: students.sum { |student| student[:ungraded_count] },
        redos: students.sum { |student| student[:redo_count] },
        open_help: @cohort.help_requests.active_queue.count
      },
      students: students
    }
  end

  def assigned_block_ids_for(user_id)
    enrollment = @cohort.enrollments.find_by(user_id: user_id)
    return [] unless enrollment

    enrollment.module_assignments.includes(curriculum_module: { lessons: :content_blocks })
      .flat_map { |assignment| assignment.curriculum_module.lessons.flat_map(&:completion_block_ids) }.uniq
  end

  def progress_for(user_id, block_ids)
    return 0 if block_ids.empty?

    completed = Progress.completed.where(enrollment_id: @cohort.enrollments.where(user_id: user_id).select(:id), content_block_id: block_ids).count
    (completed.to_f / block_ids.size * 100).round(1)
  end
end
