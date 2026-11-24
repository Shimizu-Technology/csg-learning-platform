# An explicit allowlist. Never serialize a cohort/curriculum or lesson body publicly.
class PublicCourseSerializer
  def self.call(cohort)
    raise ActiveRecord::RecordNotFound if cohort.public_slug.blank?

    selected_ids = cohort.content_defaults&.filter_map { |id, value| id if value["assigned"] }
    modules = cohort.curriculum.modules.ordered
    modules = modules.where(id: selected_ids) if selected_ids
    outline = modules.filter_map do |mod|
      titles = mod.lessons.active.where(id: ContentBlock.select(:lesson_id)).ordered.pluck(:title)
      next if titles.empty?

      # Module names are staff-managed; numbered sections avoid exposing them.
      { title: "Section", lessons: titles }
    end
    default_name = cohort.guided? ? "Small-class course" : "Self-paced course"
    access_months = if cohort.guided?
      cohort.guided_access_ends_on.present? ? nil : cohort.guided_access_months
    else
      cohort.self_paced_access_months
    end
    support_weeks = if cohort.guided?
      cohort.guided_support_ends_on.present? ? nil : cohort.guided_support_weeks
    else
      cohort.self_paced_support_weeks
    end
    capacity = cohort.seat_capacity(include_taken_when_unlimited: false)
    {
      id: cohort.id, slug: cohort.public_slug,
      course_delivery: cohort.course_delivery,
      unlisted: cohort.unlisted?,
      name: cohort.public_title.presence || default_name,
      description: cohort.public_description, image_url: cohort.public_image_url,
      curriculum_name: cohort.public_title.presence || default_name,
      outcomes: cohort.public_outcomes, duration: cohort.public_duration,
      prerequisites: cohort.public_prerequisites, preview: cohort.public_preview,
      lesson_count: outline.sum { |section| section[:lessons].length }, syllabus: outline,
      checkout_available: CourseCheckout.enabled? && cohort.purchase_ready?,
      price_cents: cohort.public_price_cents, currency: "USD",
      access_months: access_months,
      guided_access_ends_on: cohort.guided? ? cohort.guided_access_ends_on&.iso8601 : nil,
      guided_support_ends_on: cohort.guided? ? cohort.guided_support_ends_on&.iso8601 : nil,
      start_date: cohort.guided? ? cohort.start_date&.iso8601 : nil,
      includes_private_meetings: false, instructor_message_weeks: support_weeks,
      instructor_response_target: cohort.effective_review_response_time,
      includes_individual_project_review: true,
      **capacity.slice(:seat_limit, :seats_taken, :seats_remaining, :sold_out)
    }
  end
end
