require "test_helper"

class LearningDestinationTest < ActiveSupport::TestCase
  test "lessons keep source cohort and exact feedback block with legacy compatibility" do
    assert_equal "/lessons/42", LearningDestination.lesson(lesson_id: 42)
    assert_equal "/lessons/42?cohort_id=2#block-8", LearningDestination.lesson(lesson_id: 42, cohort_id: 2, block_id: 8)
    assert_equal "/lesson/42?cohort_id=2&block_id=8", ExpoPushNotificationService.mobile_learning_path("/lessons/42?cohort_id=2#block-8")
    assert_equal "/lesson/42", ExpoPushNotificationService.mobile_learning_path("/lessons/42")
  end

  test "primary and legacy recording identities survive both transports" do
    primary = LearningDestination.recording(recording_id: 9, cohort_id: 2)
    legacy = LearningDestination.recording(recording_id: 0, cohort_id: 2, source: "legacy")
    assert_equal "/recordings?cohort_id=2&recording=9", primary
    assert_equal "/recordings?cohort_id=2&recording=legacy-2-1", legacy
    assert_equal "/recording/9?cohort_id=2", ExpoPushNotificationService.mobile_learning_path(primary)
    assert_equal "/recording/legacy-2-1?cohort_id=2", ExpoPushNotificationService.mobile_learning_path(legacy)
    assert_equal "/recordings", ExpoPushNotificationService.mobile_learning_path("/recordings")
  end
  test "legacy help paths gain exact context without rewriting stored records" do
    request = Struct.new(:context_type, :context_id, :cohort_id, :context_source, :context_path).new("lesson", 42, 2, "primary", "/lessons/42")
    assert_equal "/lessons/42?cohort_id=2", LearningDestination.help_request(request)
    assert_equal "/lessons/42", request.context_path
    request.context_type = "recording"
    request.context_source = "legacy"
    request.context_id = 0
    request.context_path = "/recordings"
    assert_equal "/recordings?cohort_id=2&recording=legacy-2-1", LearningDestination.help_request(request)
  end
end
