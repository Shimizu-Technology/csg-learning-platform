require_relative "apply_submission_audit_20261118"

module Ops
  class SubmissionAuditBaseline20261118
    def initialize(cutoff:, output: $stdout, diagnostics: $stderr)
      @cutoff = Time.iso8601(cutoff)
      @output, @diagnostics = output, diagnostics
    end

    def run
      ApplicationRecord.transaction do
        # A standalone export sees one read-only snapshot. Transactional tests
        # already have an outer transaction, so cannot change its isolation.
        connection = ApplicationRecord.connection
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY") if connection.open_transactions == 1
        school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
        library = ApplySubmissionAudit20261118.library_blocks(school: school)
        library_ids = library.map(&:id)
        @diagnostics.puts JSON.generate(library_count: library.size, library_ids: library_ids,
          library_blocks: library.map { |block| { id: block.id, title: block.title, lesson: block.lesson.title } })
        overlap = library_ids & ApplySubmissionAudit20261118.fixed_ids
        problems = []
        problems << { reason: "library selection must contain exactly 82 candidates", count: library.size } unless library.size == 82
        problems << { reason: "library ids overlap fixed decisions", ids: overlap } if overlap.any?
        fixed = ApplySubmissionAudit20261118::PRACTICE + ApplySubmissionAudit20261118::TYPES.keys + ApplySubmissionAudit20261118::COMPANIONS.keys
        ids = (library_ids + fixed).uniq
        blocks = ContentBlock.where(id: ids).includes(lesson: { curriculum_module: :curriculum }).order(:id).to_a
        (ids - blocks.map(&:id)).each { |id| problems << { id: id, reason: "block missing" } }
        rows = blocks.map do |block|
          lesson = block.lesson
          problems << { id: block.id, reason: "block updated after cutoff", updated_at: block.updated_at.iso8601(6) } if block.updated_at > @cutoff
          problems << { id: block.id, lesson_id: lesson.id, reason: "lesson updated after cutoff", updated_at: lesson.updated_at.iso8601(6) } if lesson.updated_at > @cutoff
          { id: block.id, title: block.title, lesson_id: lesson.id, lesson_title: lesson.title,
            curriculum_id: lesson.curriculum_module.curriculum_id, curriculum_name: lesson.curriculum_module.curriculum.name,
            content_digest: SubmissionAudit.digest(block), block_updated_at: block.updated_at.iso8601(6), lesson_updated_at: lesson.updated_at.iso8601(6) }
        end
        if problems.any?
          result = { refused: true, cutoff: @cutoff.iso8601(6), offenders: problems }
          problems.each { |problem| @diagnostics.puts JSON.generate(problem) }
        else
          result = { source: "production_export", exported_at: Time.current.iso8601(6), cutoff: @cutoff.iso8601(6), library_ids: library_ids, blocks: rows }
        end
        @output.puts JSON.generate(result)
        result
      end
    rescue ApplySubmissionAudit20261118::Refused => error
      result = { refused: true, offenders: [ { reason: error.message } ] }
      @output.puts JSON.generate(result)
      result
    end
  end
end
