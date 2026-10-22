# Canonical web destinations. Native translates the lesson fragment to block_id.
class LearningDestination
  def self.lesson(lesson_id:, cohort_id: nil, block_id: nil)
    path = "/lessons/#{lesson_id}"
    path += "?cohort_id=#{cohort_id}" if cohort_id
    path += "#block-#{block_id}" if block_id
    path
  end

  def self.submission(submission)
    lesson(lesson_id: submission.content_block.lesson_id, cohort_id: submission.enrollment&.cohort_id, block_id: submission.content_block_id)
  end

  # Recover exact destinations for requests saved before cohort/block links existed.
  def self.help_request(request)
    case request.context_type
    when "lesson"
      lesson(lesson_id: request.context_id, cohort_id: request.cohort_id)
    when "exercise"
      block = ContentBlock.find_by(id: request.context_id)
      block ? lesson(lesson_id: block.lesson_id, cohort_id: request.cohort_id, block_id: block.id) : request.context_path
    when "recording"
      recording(recording_id: request.context_id, cohort_id: request.cohort_id, source: request.context_source)
    else request.context_path
    end
  end

  def self.recording(recording_id:, cohort_id:, source: "primary")
    identity = source == "legacy" ? "legacy-#{cohort_id}-#{recording_id.to_i + 1}" : recording_id
    "/recordings?cohort_id=#{cohort_id}&recording=#{identity}"
  end
end
