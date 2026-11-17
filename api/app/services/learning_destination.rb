# Canonical web destinations. Native translates the lesson fragment to block_id.
class LearningDestination
  def self.lesson(lesson_id:, cohort_id: nil, block_id: nil)
    RecordDestination.to_web_path(RecordDestination.build(kind: "lesson", id: lesson_id, context: { cohort_id: cohort_id }, anchor: { block_id: block_id }))
  end

  def self.submission(submission)
    lesson(lesson_id: submission.content_block.lesson_id, cohort_id: submission.enrollment&.cohort_id, block_id: submission.content_block_id)
  end

  # Recover exact destinations for requests saved before cohort/block links existed.
  # Lists pass `blocks` (from `help_request_blocks`) so exercises cost one query in all.
  def self.help_request(request, blocks: nil)
    case request.context_type
    when "lesson"
      lesson(lesson_id: request.context_id, cohort_id: request.cohort_id)
    when "exercise"
      block = blocks ? blocks[request.context_id] : ContentBlock.find_by(id: request.context_id)
      block ? lesson(lesson_id: block.lesson_id, cohort_id: request.cohort_id, block_id: block.id) : request.context_path
    when "recording"
      recording(recording_id: request.context_id, cohort_id: request.cohort_id, source: request.context_source)
    else request.context_path
    end
  end

  # The exercise blocks a list of help requests was asked from, by id.
  def self.help_request_blocks(requests)
    ids = requests.select(&:context_type_exercise?).map(&:context_id).uniq
    ids.empty? ? {} : ContentBlock.where(id: ids).select(:id, :lesson_id).index_by(&:id)
  end

  def self.recording(recording_id:, cohort_id:, source: "primary")
    identity = source == "legacy" ? "legacy-#{cohort_id}-#{recording_id.to_i + 1}" : recording_id
    RecordDestination.to_web_path(RecordDestination.build(kind: "recording", id: identity, context: { cohort_id: cohort_id }))
  end
end
