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
    {
      id: cohort.id, slug: cohort.public_slug,
      name: cohort.public_title.presence || "Self-paced course",
      description: cohort.public_description, image_url: cohort.public_image_url,
      curriculum_name: cohort.public_title.presence || "Self-paced course",
      outcomes: cohort.public_outcomes, duration: cohort.public_duration,
      prerequisites: cohort.public_prerequisites, preview: cohort.public_preview,
      lesson_count: outline.sum { |section| section[:lessons].length }, syllabus: outline,
      checkout_available: CourseCheckout.enabled? && cohort.purchase_ready?,
      price_cents: cohort.public_price_cents, currency: "USD",
      access_months: cohort.self_paced_access_months,
      includes_private_meetings: false, instructor_message_weeks: cohort.self_paced_support_weeks,
      instructor_response_target: cohort.effective_review_response_time,
      includes_individual_project_review: true
    }
  end
end
