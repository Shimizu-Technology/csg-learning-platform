# One course outline for every delivery mode (C-2, U-5.6, S-1, S-9): what the
# redesigned Learn page shows. Every status, count and "next" comes from
# LearnerProgress, the one complete/next definition (AS-10), and every lesson's
# kind from LessonKind, so the page never works out progress itself.
#
# Modes:
# - "program" (live and guided programs): modules, then weeks with dates. A
#   lesson's week is its curriculum week (module day offset plus release day),
#   the same numbering staff schedule by. A week opens on its first lesson's
#   unlock date for this learner.
# - "self_paced": modules as numbered sections, lessons numbered in course
#   order, and no dates or weekdays (self-paced ignores unlock dates).
# - "library" (CSG Alumni): modules to browse. No progress counts, no next
#   step and no filters (U-5.10).
# Outside programs, a module that spans several curriculum weeks is split into
# undated parts, so a long section still collapses.
#
# The current group is the one holding the next lesson; Learn opens it. A
# read-only enrollment (paused, ended) has no next step: past lessons stay
# open to read (§12, decision 7).
#
# Queries: LearnerProgress's fixed set plus none per lesson, so the outline
# costs the same for 6 lessons or 600.
class CourseOutline
  def initialize(enrollment, progress: nil, now: Time.current)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @progress = progress || LearnerProgress.new(enrollment, now: now)
    @content = @progress.content
    @today = @progress.today
  end

  def call
    numbers = @progress.lessons.each_with_index.to_h { |lesson, index| [ lesson.id, index + 1 ] }
    redo_blocks = @progress.redo_submissions.reverse.to_h { |submission| [ submission.content_block.lesson_id, submission.content_block_id ] }
    read_only = !@enrollment.active?
    next_lesson = read_only || library? ? nil : @progress.next_lesson
    modules = @content.modules.each_with_index.map do |mod, index|
      module_json(mod, index + 1, numbers, redo_blocks, next_lesson)
    end
    groups = modules.flat_map { |mod| mod[:groups] }
    lessons = groups.flat_map { |group| group[:lessons] }
    current = groups.find { |group| group[:current] }
    # This week: the program week that opened most recently, across the course. Paused learners aren't on the schedule.
    if program? && !read_only
      latest = groups.select { |group| group[:opens_on] && group[:opens_on] <= @today }.max_by.with_index { |group, index| [ group[:opens_on], index ] }
      latest[:this_week] = true if latest
    end

    {
      mode: mode,
      cohort: { id: @cohort.id, name: @cohort.name, cohort_type: @cohort.cohort_type, course_delivery: @cohort.course_delivery },
      course_title: @cohort.public_title.presence || CurriculumName.in_cohort(@cohort),
      enrollment_status: @enrollment.status,
      paused_since: @enrollment.pause_date,
      read_only: read_only,
      counts: library? ? nil : @progress.overall.slice(:completed_lessons, :total_lessons),
      course_week: course_week,
      lesson_count: lessons.size,
      next_lesson: next_lesson && lessons.find { |lesson| lesson[:id] == next_lesson.id }&.merge(module_id: next_lesson.module_id, group_key: current&.dig(:key)),
      current_group_key: current&.dig(:key),
      filters: { todo: lessons.count { |lesson| lesson[:todo] }, redo: library? ? 0 : lessons.count { |lesson| lesson[:status] == LearnerProgress::Status::REDO } },
      modules: modules
    }
  end

  private

  def mode
    return "library" if library?

    @cohort.self_paced? ? "self_paced" : "program"
  end

  def library? = @cohort.alumni?

  def program? = mode == "program"

  def module_json(mod, number, numbers, redo_blocks, next_lesson)
    entries = @content.lessons_for(mod).map { |lesson| @progress.lesson_progress(lesson) }
    grouped = entries.group_by { |entry| CourseWeeks.number(mod, entry.lesson) }
    grouped = { 1 => entries } if !program? && grouped.size < 2
    groups = grouped.sort.each_with_index.map do |(week, items), index|
      lessons = items.map { |entry| lesson_json(mod, entry, numbers, redo_blocks) }
      {
        key: "m#{mod.id}-#{index + 1}",
        label: group_label(week, index, grouped.size, lessons),
        week: program? ? week : nil,
        opens_on: program? ? opens_on(mod, items) : nil,
        available: items.any?(&:available),
        current: next_lesson.present? && items.any? { |entry| entry.lesson.id == next_lesson.id },
        this_week: false,
        counts: library? ? nil : counts(items),
        lessons: lessons
      }
    end
    {
      id: mod.id,
      name: mod.name,
      number: number,
      available: entries.any?(&:available),
      counts: library? ? nil : counts(entries),
      groups: groups
    }
  end

  # "Week 3" in programs; "Part 2 · lessons 21–40" in a split self-paced or
  # library section; nothing when a section is one group.
  def group_label(week, index, group_count, lessons)
    return "Week #{week}" if program?
    return nil if group_count < 2

    first, last = lessons.map { |lesson| lesson[:number] }.minmax
    "Part #{index + 1} · lessons #{first}–#{last}"
  end

  def lesson_json(mod, entry, numbers, redo_blocks)
    lesson = entry.lesson
    {
      id: lesson.id,
      title: lesson.title,
      kind: LessonKind.for(lesson),
      number: numbers.fetch(lesson.id),
      status: entry.status,
      required: entry.required,
      available: entry.available,
      opens_on: entry.available || !program? ? nil : unlock_date(mod, lesson),
      todo: !@enrollment.active? || library? ? false : @progress.actionable?(entry),
      redo_block_id: entry.status == LearnerProgress::Status::REDO ? redo_blocks[lesson.id] : nil
    }
  end

  # Counted lessons only (a personal plan's optional lessons are not counted),
  # by the same rule as the course total.
  def counts(entries)
    LearnerProgress.lesson_counts(entries.select { |entry| @progress.counted?(entry.lesson) })
  end

  def opens_on(mod, entries)
    CourseWeeks.opens_on(@cohort, mod, entries.map(&:lesson), @content)
  end

  def unlock_date(mod, lesson)
    lesson.assigned_unlock_date(@cohort, @content.module_assignments[mod.id], @content.lesson_assignments[lesson.id])
  end

  # "Week 11 of 16" for a dated program.
  def course_week
    return nil unless program? && @cohort.start_date && @cohort.end_date && @today >= @cohort.start_date

    total = ((@cohort.end_date - @cohort.start_date).to_i / 7) + 1
    { current: [ ((@today - @cohort.start_date).to_i / 7) + 1, total ].min, total: total }
  end
end
