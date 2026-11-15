require_relative "../support/model_coverage"

class AnnouncementTest < ModelCoverageTestCase
  test "publication visibility audience access and active recipients differ from read access" do
    enrollment
    row = Announcement.create!(author: staff, cohort: course, title: "Notice", body: "Body", audience: :cohort, status: :published)
    assert_equal Time.current, row.published_at
    assert_includes Announcement.visible_for(student), row
    assert_empty Announcement.visible_for(nil)
    assert_not Announcement.visible_for(person).exists?(row.id)
    assert_includes row.recipients, student
    enrollment.update!(status: :paused)
    assert_includes Announcement.visible_for(student), row
    assert_not row.recipients.exists?(student.id)
    row.update!(published_at: 1.hour.from_now)
    assert_not Announcement.visible_now.exists?(row.id)
    assert_invalid row, :cohort, nil
    row.audience = :global
    assert_not row.valid?
    assert row.errors[:cohort].any?
  end
end
