# One-off approved decisions. No network or production-specific connection setup.
module Ops
  class ApplySubmissionAudit20261118
    class Refused < StandardError; end
    LIBRARY = "CSG Alumni Learning Library".freeze
    PRACTICE = [ 181, 353, 1079, 1083, 1085, 1087, 1103, 1105, 1107 ].freeze
    TYPES = { 57 => "repo_url_submission", 700 => "repo_url_submission" }.freeze
    COMPANIONS = { 356 => "repo_and_live_url_submission", 358 => "repo_and_live_url_submission",
      1088 => "repo_url_submission", 1099 => "repo_url_submission", 1093 => "text_submission",
      1101 => "repo_and_live_url_submission" }.freeze
    DEFERRED = [ 681, 684, 679, 693, 696 ].freeze
    MARKER = "submission_audit_20261118".freeze

    def initialize(admin:, baseline:, apply: false, output: $stdout)
      raise Refused, "ADMIN_USER_ID must identify an active admin" unless admin&.admin? && admin.archived_at.nil?
      raise Refused, "baseline must identify audit_commit d68e0b3" unless baseline.fetch("audit_commit").to_s.start_with?("d68e0b3")

      @admin, @apply, @output = admin, apply, output
      rows = baseline.fetch("blocks")
      @baseline = rows.index_by { |row| Integer(row.fetch("id")) }
      raise Refused, "duplicate baseline block ids" unless rows.size == @baseline.size
      @school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
    end

    def run
      decisions = PRACTICE.to_h { |id| [ id, [ "practice", nil ] ] }
        .merge(TYPES.transform_values { |type| [ "type", type ] })
        .merge(COMPANIONS.transform_values { |type| [ "companion", type ] })
      library = Curriculum.where(name: LIBRARY).to_a
      library_rows = @baseline.values.select { |row| row["curriculum_name"] == LIBRARY }
      raise Refused, "baseline must contain exactly 82 library blocks; curriculum must be unique" unless library.one? && library_rows.size == 82
      ids = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: library.first.id }).pluck(:id)
      raise Refused, "library baseline blocks no longer belong to the curriculum" unless (library_rows.map { |r| r.fetch("id").to_i } - ids).empty?
      current_candidates = SubmissionAudit.blocks.select { |block| ids.include?(block.id) }.map(&:id)
      raise Refused, "library candidate set changed" unless (current_candidates - library_rows.map { |r| r.fetch("id").to_i }).empty?
      library_rows.each { |row| decisions[row.fetch("id").to_i] = [ "practice", nil ] }
      report = []
      decisions.group_by { |id, _| ContentBlock.find_by(id: id)&.lesson_id }.each do |lesson_id, entries|
        if lesson_id.nil?
          entries.each { |id, (action, type)| report << { id: id, action: action, target: type, status: "refused", reason: "block missing" } }
          next
        end
        rows = []
        begin
          ApplicationRecord.transaction do
            lesson = Lesson.find(lesson_id)
            lesson.lock!("FOR NO KEY UPDATE")
            blocks = lesson.content_blocks.order(:position, :id).to_a
            ContentBlock.lock_for_authoring!(blocks.map(&:id), exclusive: blocks.map(&:id))
            rows = entries.map do |id, (action, type)|
              block = blocks.find { |item| item.id == id }
              inspect_decision(block, action, type)
            end
            raise Refused, rows.filter_map { |row| row[:reason] if row[:status] == "refused" }.join("; ") if rows.any? { |row| row[:status] == "refused" }
            pending = rows.select { |row| row[:status] == "pending" }
            if blocks.size + pending.count { |row| row[:action] == "companion" } > ContentBlock::MAX_PER_LESSON
              raise Refused, "companion would exceed the lesson block limit"
            end
            if @apply && pending.any?
              save_content!(lesson, blocks, pending)
              pending.each do |row|
                next unless row[:action] == "practice"
                block = ContentBlock.find(row[:id])
                review = block.submission_audit_review || block.build_submission_audit_review
                review.update!(content_digest: SubmissionAudit.digest(block), reviewed_by: @admin)
              end
            end
            pending.each { |row| row[:status] = @apply ? "applied" : "dry_run" }
          end
        rescue Refused, LessonBlockEditor::Invalid, LessonBlockEditor::Stale, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound, ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout => error
          rows = entries.map { |id, (action, type)| { id: id, action: action, target: type } } if rows.empty?
          rows.each do |row|
            next if row[:status] == "already_applied"
            row[:status] = "refused"
            row[:reason] = "lesson rolled back: #{error.message}"
          end
        end
        report.concat(rows)
      end
      DEFERRED.each { |id| report << { id: id, status: "skipped", reason: "deferred to W9" } }
      emit(report)
    rescue Refused => error
      emit([ { status: "refused", reason: error.message } ])
    end

    private

    def emit(report)
      report.each { |row| @output.puts(row.to_json) }
      counts = %w[applied skipped refused dry_run already_applied].index_with(0)
        .merge(report.group_by { |row| row[:status] }.transform_values(&:size))
      result = { apply: @apply, counts: counts, blocks: report }
      @output.puts "Summary: #{counts.to_json}"
      @output.puts JSON.generate(result)
      result
    end

    def inspect_decision(block, action, type)
      raise Refused, "block moved or missing" unless block
      lesson = block.lesson
      curriculum = lesson.curriculum_module.curriculum
      impact = LessonCompletionImpact.for_lesson(lesson, viewer: @admin)
      row = { id: block.id, curriculum: curriculum.name, lesson: lesson.title, title: block.title,
        action: action, current: { block_type: block.block_type, submission_type: block.submission_type, digest: SubmissionAudit.digest(block) },
        target: type || "practice review", completion_impact: impact,
        completed_block_learners: Progress.completed.where(content_block_id: block.id).distinct.count(:user_id),
        cohorts: SubmissionAudit.cohort_submissions(block, school: @school), status: "pending" }
      begin
        baseline = @baseline[block.id]
        raise Refused, "missing audit baseline" unless baseline
        raise Refused, "curriculum or lesson changed" unless baseline.fetch("curriculum_id").to_i == curriculum.id && baseline.fetch("lesson_id").to_i == lesson.id
        digest = baseline.fetch("content_digest")
        raise Refused, "invalid audit digest" unless digest.is_a?(String) && digest.match?(/\A[0-9a-f]{64}\z/)
        companions = lesson.content_blocks.select { |b| b.metadata&.dig(MARKER, "source_id") == block.id }
        if action == "companion" && companions.any?
          companion = companions.sole
          receipt = companion.metadata.fetch(MARKER)
          raise Refused, "companion or source changed" unless receipt["baseline_digest"] == digest && editor_flag_matches?(lesson) && original_content_matches?(block, digest) && companion.title == "Exercise: #{block.title}" && companion.body == instructions(type) && companion.exercise? && companion.submission_type == type && companion.position == block.position + 1
          row[:status] = "already_applied"
        elsif action == "type" && block.submission_type == type
          # Reconstruct only the two eligible original submission states. The
          # editor may have updated the lesson's legacy requires_submission flag.
          matches = [ nil, "manual_complete" ].product([ false, true ]).any? do |old_type, required|
            Digest::SHA256.hexdigest([ block.title, block.body, block.block_type, old_type, required ].to_json) == digest
          end
          raise Refused, "content changed after type decision" unless matches && block.student_work_block? && editor_flag_matches?(lesson)
          row[:status] = "already_applied"
        elsif action == "practice" && block.submission_audit_review&.content_digest == SubmissionAudit.digest(block) && original_content_matches?(block, digest) && editor_flag_matches?(lesson)
          raise Refused, "no longer an audit candidate" unless SubmissionAudit.candidate?(block, school: @school)
          row[:status] = "already_applied"
        else
          raise Refused, "content digest changed" unless digest == SubmissionAudit.digest(block)
          if action == "type"
            raise Refused, "no longer a work block" unless block.student_work_block? && block.knowledge_check.nil?
            raise Refused, "conflicting learner submissions" if block.submissions.any? { |submission| submission.effective_submission_type != type }
          else
            raise Refused, "no longer an audit candidate" unless SubmissionAudit.candidate?(block, school: @school)
          end
          if action == "practice" && block.submission_audit_review&.content_digest == digest
            row[:status] = "already_applied"
          elsif action == "companion" && impact[:completed_learners].positive?
            raise Refused, "lesson has completed learners; reopening is not authorized"
          end
        end
      rescue Refused, KeyError, ActiveRecord::SoleRecordExceeded => error
        row[:status], row[:reason] = "refused", error.message
      end
      row
    end

    def save_content!(lesson, blocks, pending)
      changes = pending.index_by { |row| row[:id] }
      payload = blocks.flat_map do |block|
        item = { id: block.id, block_type: block.block_type }
        if (check = block.knowledge_check)
          item[:knowledge_check] = check.attributes.slice("prompt", "options", "correct_option", "explanation", "learning_objective_id")
        end
        change = changes[block.id]
        next [ item ] unless change
        if change[:action] == "type"
          item[:submission_type] = change[:target]
          [ item ]
        elsif change[:action] == "companion"
          body = instructions(change[:target])
          [ item, { client_id: "audit-#{block.id}", block_type: "exercise", title: "Exercise: #{block.title}", body: body,
            submission_type: change[:target], metadata: { MARKER => { source_id: block.id, baseline_digest: @baseline.fetch(block.id).fetch("content_digest") } } } ]
        else
          [ item ]
        end
      end
      return unless pending.any? { |row| row[:action] != "practice" }
      LessonBlockEditor.new(lesson: lesson, params: { base_updated_at: lesson.updated_at.iso8601(6), blocks: payload }, user: @admin).save!
    end

    def editor_flag_matches?(lesson)
      primary = lesson.primary_assignment_block
      return true unless primary&.submission_type.present?
      lesson.requires_submission == ContentBlock::REVIEW_REQUIRED_SUBMISSION_TYPES.include?(primary.submission_type)
    end

    def original_content_matches?(block, digest)
      [ false, true ].any? do |required|
        Digest::SHA256.hexdigest([ block.title, block.body, block.block_type, block.submission_type, required ].to_json) == digest
      end
    end

    def instructions(type)
      case type
      when "repo_and_live_url_submission" then "Submit your GitHub repository URL and the live deployed URL for this exercise."
      when "repo_url_submission" then "Submit the GitHub repository URL containing your completed assignment and a README explaining how to run and test it."
      else "Submit your evaluation results and a short explanation of your approach and findings."
      end
    end
  end
end
