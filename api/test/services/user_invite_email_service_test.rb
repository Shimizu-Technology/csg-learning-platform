require "test_helper"

class UserInviteEmailServiceTest < ActiveSupport::TestCase
  setup do
    @original_key = ENV["RESEND_API_KEY"]
    @original_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"
    @original_send = Resend::Emails.method(:send)
    @requests = []
    requests = @requests
    Resend::Emails.define_singleton_method(:send) do |params, options: {}|
      requests << params
      { id: "invite-provider-message-id" }
    end
  end

  teardown do
    Resend::Emails.define_singleton_method(:send, @original_send)
    ENV["RESEND_API_KEY"] = @original_key
    ENV["RESEND_FROM_EMAIL"] = @original_from
  end

  test "invitation names CSG Learn and uses the CSG brand colours" do
    inviter = User.create!(clerk_id: "invite_inviter", email: "inviter@example.com", first_name: "Ana", last_name: "Admin", role: :admin)
    learner = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "new-learner@example.com", role: :student)

    assert UserInviteEmailService.send_invite(user: learner, invited_by: inviter, invitation_url: "https://accounts.example.com/invite?ticket=abc")

    request = @requests.sole
    assert_equal [ { name: "application", value: "csg_learn" } ], request[:tags]
    assert_equal "You're invited to CSG Learn at Code School of Guam", request[:subject]
    html = request[:html]
    assert_includes html, "You're invited to CSG Learn"
    assert_includes html, "Ana Admin added you as a <strong style=\"color: #0f172a;\">Student</strong> in CSG Learn"
    assert_includes html, "new-learner@example.com"
    # The fallback link shows the same invitation URL it opens, so copying it keeps the ticket.
    assert_includes html, ">https://accounts.example.com/invite?ticket=abc</a>"
    assert_includes html, "#9c292b"
    assert_includes html, "Accept invitation"
    assert_includes html, "continue with Google"
    assert_includes html, "expires in #{User::INVITE_LINK_LIFETIME.in_days.to_i} days"
    assert_includes html, "mailto:#{SchoolBrand.current.support_email}"
    refute_match(/#2563eb|#7c3aed|CSG Connect|CSG Learning/, html)
  end

  test "invitation includes the enrolled course or cohort name and escapes it" do
    inviter = User.create!(clerk_id: "invite_inviter_course", email: "inviter-course@example.com", first_name: "Ana", last_name: "Admin", role: :admin)
    learner = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "course-learner@example.com", role: :student)
    curriculum = Curriculum.create!(name: "Prework", status: :active)
    cohort = Cohort.create!(name: "Fall <Cohort> 2026", curriculum: curriculum, start_date: Date.current, status: :active)
    Enrollment.create!(user: learner, cohort: cohort, status: :active)

    assert UserInviteEmailService.send_invite(user: learner, invited_by: inviter, invitation_url: "https://accounts.example.com/invite?ticket=xyz")

    html = @requests.sole[:html]
    assert_includes html, "Fall &lt;Cohort&gt; 2026"
    refute_includes html, "Fall <Cohort> 2026"
  end

  test "invitation escapes inviter names" do
    inviter = User.create!(clerk_id: "invite_inviter_xss", email: "inviter-xss@example.com", first_name: "<script>", last_name: "x", role: :admin)
    learner = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "escape-learner@example.com", role: :student)

    assert UserInviteEmailService.send_invite(user: learner, invited_by: inviter)

    refute_includes @requests.sole[:html], "<script>"
  end
end
