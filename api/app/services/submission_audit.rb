# Suggestions only: never updates content or learner progress.
class SubmissionAudit
  TERMS = /\b(submit|push|turn in|create a repo(?:sitory)?|build|deploy|screenshot|share your link)\b/i

  def self.digest(block)
    Digest::SHA256.hexdigest([ block.title, block.body ].to_json)
  end

  def self.suggested_type(block)
    text = "#{block.title} #{block.body}"
    return "repo_and_live_url_submission" if text.match?(/\bdeploy\b/i)
    return "repo_url_submission" if text.match?(/\b(repo(?:sitory)?|github|push)\b/i)

    "text_submission"
  end

  def self.blocks
    ContentBlock.joins(lesson: :curriculum_module)
      .where(submission_type: [ nil, :manual_complete ], lessons: { archived_at: nil })
      .includes(:submission_audit_review, lesson: { curriculum_module: :curriculum })
      .order("modules.curriculum_id", "modules.position", "lessons.release_day", "lessons.position", "content_blocks.position", "content_blocks.id")
      .select { |block| block.effective_submission_type == "manual_complete" && "#{block.title} #{block.body}".match?(TERMS) && block.submission_audit_review&.content_digest != digest(block) }
  end

  def self.rows
    blocks = self.blocks
    counts = Progress.completed.where(content_block_id: blocks.map(&:id)).group(:content_block_id).distinct.count(:user_id)
    blocks.map do |block|
      lesson = block.lesson
      mod = lesson.curriculum_module
      { id: block.id, title: block.title, body: block.body, lesson_id: lesson.id, lesson_title: lesson.title,
        module_id: mod.id, module_name: mod.name, curriculum_id: mod.curriculum.id, curriculum_name: mod.curriculum.name,
        completed_learners: counts.fetch(block.id, 0), suggested_type: suggested_type(block), content_digest: digest(block) }
    end
  end
end
