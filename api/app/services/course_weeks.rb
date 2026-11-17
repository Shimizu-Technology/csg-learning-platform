# Learn's curriculum weeks and their actual enrollment schedule, including
# module/lesson overrides. A break does not advance the curriculum week.
class CourseWeeks
  def self.number(mod, lesson)
    (mod.day_offset.to_i + lesson.release_day) / 7 + 1
  end

  def self.opens_on(cohort, mod, lessons, content)
    lessons.filter_map { |lesson| lesson.assigned_unlock_date(cohort, content.module_assignments[mod.id], content.lesson_assignments[lesson.id]) }.min
  end

  def self.groups(cohort, content)
    content.modules.flat_map do |mod|
      content.lessons_for(mod).group_by { |lesson| number(mod, lesson) }.sort.map do |week, lessons|
        { week: week, opens_on: opens_on(cohort, mod, lessons, content) }
      end
    end
  end

  def self.on(date, groups)
    groups.select { |group| group[:opens_on] && group[:opens_on] <= date }
      .max_by.with_index { |group, index| [ group[:opens_on], index ] }&.fetch(:week)
  end
end
