class RecordDetail
  # A class recording (L-5.2): its cohort and the week it was recorded in, the
  # lessons whose Video or Recording blocks play it (with their sections), and
  # who in the cohort has watched it. Staff only; learners keep Recordings.
  #
  # A lesson block plays the recording when its video is the same upload
  # (`s3_video_key` = `s3_key`) or the same link (`video_url` = `source_url`),
  # on the cohort's curriculum. Watch rows are the cohort's learners with read
  # access who have started it.
  class RecordingPage < Base
    private

    def cohort_id_for(id)
      ::Recording.where(id: id).pick(:cohort_id)
    end

    def build
      recording = ::Recording.includes(:uploaded_by, :cohort).find(@id)
      cohort = recording.cohort
      enrollments = Enrollment.with_read_access.joins(:user).merge(User.where(role: :student)).where(cohort_id: cohort.id)
      progress = WatchProgress.where(recording_id: recording.id, user_id: enrollments.select(:user_id))
        .includes(:user).order(last_watched_at: :desc, id: :desc).to_a

      {
        type: "recording",
        id: recording.id,
        title: recording.title,
        description: recording.description,
        status: recording.status,
        source: recording.source_kind,
        url: recording.uploaded? ? nil : recording.source_url,
        duration_seconds: recording.duration_seconds,
        recorded_date: recording.recorded_date&.to_date&.iso8601,
        published_at: iso(recording.published_at),
        created_at: iso(recording.created_at),
        uploaded_by: person(recording.uploaded_by),
        cohort: cohort_json(cohort),
        week: program_week(cohort, recording.recorded_date),
        can_edit: @viewer.can_teach_cohort?(cohort),
        lessons: lessons(recording, cohort),
        students_count: enrollments.count,
        watchers: progress.map do |row|
          { student: person(row.user), progress_percentage: row.progress_percentage, completed: row.completed,
            last_watched_at: iso(row.last_watched_at) }
        end
      }
    end

    def lessons(recording, cohort)
      matches = []
      matches << ContentBlock.where(s3_video_key: recording.s3_key) if recording.s3_key.present?
      matches << ContentBlock.where(video_url: recording.source_url) if recording.source_url.present?
      return [] if matches.empty?

      blocks = ContentBlock.where(block_type: %i[video recording])
        .merge(matches.reduce { |all, match| all.or(match) })
        .joins(lesson: :curriculum_module)
        .where(modules: { curriculum_id: cohort.curriculum_id })
        .includes(lesson: :curriculum_module)
        .order("modules.position", "lessons.release_day", "lessons.position", "content_blocks.position", "content_blocks.id")
        .to_a
      blocks.map do |block|
        lesson = block.lesson
        mod = lesson.curriculum_module
        day = mod.week_and_day_for(lesson.release_day)
        {
          lesson: { id: lesson.id, title: lesson.title, archived: lesson.archived? },
          module: { id: mod.id, name: mod.name },
          week: cohort.self_paced? ? nil : day[:week],
          block: { id: block.id, title: block.title },
          sections: Array(block.metadata["video_segments"]).filter_map do |section|
            next unless section.is_a?(Hash)

            { label: section["label"].to_s, start_seconds: section["start_seconds"].to_i, end_seconds: section["end_seconds"].to_i,
              required: section.fetch("required", true) != false }
          end
        }
      end
    end
  end
end
