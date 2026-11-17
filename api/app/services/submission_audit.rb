# Suggestions only: never updates content or learner progress.
class SubmissionAudit
  TERMS = /\b(submi(?:t|ts|tted|tting|ssion)|deploy(?:ed|ing|ment)?|screenshots?|push(?:ed|es|ing)?|create an? (?:new |github )?repo(?:sitory)?|upload|turn (?:it )?in|(?:paste|share|send) (?:us )?your (?:repo )?(?:link|url))\b/i

  def self.prose(block)
    text = "#{block.title} #{block.body}".gsub(/```.*?(?:```|\z)|~~~.*?(?:~~~|\z)/m, " ").gsub(/`[^`\n]*`/, " ")
    CGI.unescapeHTML(Rails::HTML5::FullSanitizer.new.sanitize(text))
  end

  def self.digest(block)
    Digest::SHA256.hexdigest([ block.title, block.body ].to_json)
  end

  def self.suggested_type(block)
    return unless block.student_work_block?

    text = prose(block)
    return "repo_and_live_url_submission" if text.match?(/\bdeploy(?:ed|ing|ment)?\b/i)
    return "repo_url_submission" if text.match?(/\b(repo(?:sitory)?|github|push(?:ed|es|ing)?)\b/i)

    "text_submission"
  end

  def self.cohort_submissions(block, school:)
    block.lesson.curriculum_module.curriculum.cohorts.map do |cohort|
      config = cohort.settings.dig("module_github_config", block.lesson.module_id.to_s) || {}
      type = block.effective_submission_type(requires_github: config["requires_github"] || false, feature_cohort: cohort, school: school)
      { id: cohort.id, name: cohort.name, submission_type: type }
    end
  end

  def self.candidates
    # Do not lazily create school settings on a read-only audit request.
    school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
    ContentBlock.joins(lesson: :curriculum_module)
      .joins("INNER JOIN curricula ON curricula.id = modules.curriculum_id")
      .where(submission_type: [ nil, :manual_complete ], lessons: { archived_at: nil }, curricula: { status: Curriculum.statuses.fetch("active") })
      .includes(:submission_audit_review, lesson: { curriculum_module: { curriculum: :cohorts } })
      .order("modules.curriculum_id", "modules.position", "lessons.release_day", "lessons.position", "content_blocks.position", "content_blocks.id")
      .filter_map do |block|
        next unless prose(block).match?(TERMS) && block.submission_audit_review&.content_digest != digest(block)

        cohorts = cohort_submissions(block, school: school)
        missing = cohorts.empty? ? block.effective_submission_type == "manual_complete" : cohorts.any? { |row| row[:submission_type] == "manual_complete" }
        [ block, cohorts ] if missing
      end
  end

  def self.blocks
    candidates.map(&:first)
  end

  def self.rows
    candidates = self.candidates
    counts = Progress.completed.where(content_block_id: candidates.map { |block, _| block.id }).group(:content_block_id).distinct.count(:user_id)
    candidates.map do |block, cohorts|
      lesson = block.lesson
      mod = lesson.curriculum_module
      { id: block.id, title: block.title, body: block.body, lesson_id: lesson.id, lesson_title: lesson.title,
        module_id: mod.id, module_name: mod.name, curriculum_id: mod.curriculum.id, curriculum_name: mod.curriculum.name,
        completed_learners: counts.fetch(block.id, 0), suggested_type: suggested_type(block), content_digest: digest(block), cohort_submissions: cohorts }
    end
  end
end
