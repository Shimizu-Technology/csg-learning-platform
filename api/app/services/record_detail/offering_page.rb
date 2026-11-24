class RecordDetail
  # A self-paced course on sale and its purchases (L-3.2 "offering →
  # purchases → enrollments"): the offering's terms, how many checkouts
  # reached each status, what was paid, and each purchase with its buyer and
  # the enrollment it gave them in this cohort. The id is the cohort's.
  #
  # Admins only, like the offering settings and the purchase alerts: an
  # instructor, a student, a live program and an unknown id all get the same
  # 404. Purchases come PURCHASES_PER_PAGE at a time, newest first by id. The
  # id never changes, so a cursor on it (`purchases_before`) lists each
  # purchase once even while checkouts change status between pages. Totals
  # are counted separately, so the payload stays the same size however many
  # people bought the course.
  class OfferingPage < Base
    PURCHASES_PER_PAGE = 25
    STATUSES = %w[paid pending refunded disputed failed expired].freeze

    private

    def authorized?
      admin? && Cohort.where(id: @id, course_delivery: Cohort::CHECKOUT_DELIVERIES).where.not(cohort_type: :alumni).exists?
    end

    def build
      cohort = Cohort.includes(:curriculum, :support_instructor).find(@id)
      purchases = CoursePurchase.where(cohort_id: cohort.id)
      page = @before ? purchases.where("course_purchases.id < ?", @before) : purchases
      # One past the page shows whether there is a next one.
      rows = page.includes(:user).order(id: :desc).limit(PURCHASES_PER_PAGE + 1).to_a
      more = rows.size > PURCHASES_PER_PAGE
      rows = rows.first(PURCHASES_PER_PAGE)
      enrollments = Enrollment.where(cohort_id: cohort.id, user_id: rows.map(&:user_id)).pluck(:user_id, :id, :status)
        .to_h { |user_id, id, status| [ user_id, { id: id, status: status } ] }
      counts = purchases.group(:status).count
      access_months = cohort.guided? ? (cohort.guided_access_ends_on.present? ? nil : cohort.guided_access_months) : cohort.self_paced_access_months
      support_weeks = cohort.guided? ? (cohort.guided_support_ends_on.present? ? nil : cohort.guided_support_weeks) : cohort.self_paced_support_weeks

      {
        type: "offering",
        id: cohort.id,
        title: cohort.public_title.presence || cohort.name,
        public_slug: cohort.public_slug,
        checkout_enabled: cohort.public_checkout_enabled,
        unlisted: cohort.unlisted?,
        **cohort.seat_capacity(include_breakdown: true),
        price_cents: cohort.public_price_cents,
        access_months: access_months,
        support_weeks: support_weeks,
        support_instructor: person(cohort.support_instructor),
        curriculum: cohort.curriculum && names.ref(cohort.curriculum),
        cohort: cohort_json(cohort),
        purchases_count: counts.values.sum,
        status_counts: STATUSES.to_h { |status| [ status, counts.fetch(status, 0) ] },
        paid_cents: purchases.where(status: "paid").sum(:price_cents),
        enrolled_count: Enrollment.where(cohort_id: cohort.id).count,
        purchases_next_before: more ? rows.last.id : nil,
        purchases: rows.map do |purchase|
          {
            id: purchase.id,
            status: purchase.status,
            checkout_state: purchase.checkout_state,
            over_capacity: purchase.over_capacity?,
            price_cents: purchase.price_cents,
            access_months: purchase.access_months,
            support_weeks: purchase.support_weeks,
            created_at: iso(purchase.created_at),
            updated_at: iso(purchase.updated_at),
            buyer: person(purchase.user).merge(email: purchase.user.email),
            enrollment: enrollments[purchase.user_id]
          }
        end
      }
    end
  end
end
