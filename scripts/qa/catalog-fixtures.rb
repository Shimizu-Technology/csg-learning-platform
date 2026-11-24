require_relative 'boot'
require_relative '../../api/test/support/offering_price_test_support'
extend OfferingPriceTestSupport
guided = Cohort.find_by!(course_delivery: 'program')
guided.update!(course_delivery: 'guided')
guided.update_column(:public_slug, 'course-guided-private')
cohort = Cohort.find_by!(course_delivery: 'self_paced')
cohort.update!(public_title: 'Build a garden counter', public_description: 'Learn programming by tracking a fictional garden. Practice small steps and finish a project you can explain.',
  public_outcomes: "Use variables and decisions\nBuild and explain a small counter\nImprove your work with instructor feedback", public_duration: '4–6 hours',
  public_prerequisites: 'A computer with a browser. No programming experience needed.', public_preview: "Start with two seedlings. Add three more. What should your program show?\nTry explaining the steps before writing the code.",
  public_image_url: nil, public_checkout_enabled: true, public_price_cents: 14900, stripe_price_id: 'price_qa_catalog')
stamp_verified_offering_price(cohort)
cohort.update_column(:public_slug, 'course-garden-counter')
cohort.curriculum.modules.each_with_index do |mod, i|
  mod.lessons.each_with_index { |lesson, j| lesson.update!(title: [ 'Your first counter', 'Store a value', 'Make a decision', 'Repeat a task', 'Explain your approach', 'Build your project' ][j] + (i.zero? ? '' : " · Practice #{i + 1}")) }
end
User.create!(id: 9, clerk_id: 'qa_catalog_buyer', email: 'catalog-buyer@example.invalid', first_name: 'QA', last_name: 'Buyer', role: :student,
  community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION) unless User.exists?(9)
ClerkIdentity.find_or_create_by!(user: User.find(9), issuer: 'https://test.clerk.invalid', clerk_user_id: 'qa_catalog_buyer')
CoursePurchase.find_or_create_by!(user_id: 7, cohort: cohort) do |p|
  p.status = 'paid'; p.stripe_price_id = cohort.stripe_price_id; p.price_cents = cohort.public_price_cents; p.stripe_session_id = 'cs_qa_catalog_paid'
end
Enrollment.find_by!(user_id: 7, cohort: cohort).update!(start_here_dismissed_at: nil)
puts({ cohort_id: cohort.id, slug: cohort.public_slug, purchase_id: CoursePurchase.find_by!(user_id: 7, cohort: cohort).id }.to_json)
