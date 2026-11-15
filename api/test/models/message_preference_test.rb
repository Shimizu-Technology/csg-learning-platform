require_relative "../support/model_coverage"

class MessagePreferenceTest < ModelCoverageTestCase
  test "preferences are unique per user and polymorphic target" do
    row = MessagePreference.create!(user: student, target: channel)
    assert_not row.dup.valid?
    other = MessagePreference.create!(user: person, target: channel)
    assert_database_rejects other, { user_id: student.id }, ActiveRecord::RecordNotUnique
    assert MessagePreference.create!(user: student, target: conversation).persisted?
  end
end
