# One-off approved decisions. No network or production-specific connection setup.
module Ops
  class ApplySubmissionAudit20261118
    class Refused < StandardError; end
    LIBRARY = "CSG Alumni Learning Library".freeze
    PRACTICE = [ 181, 353, 1079, 1083, 1085, 1087, 1103, 1105, 1107, 356, 358, 1088, 1093, 1099, 1101 ].freeze
    TYPES = { 57 => "repo_url_submission", 700 => "repo_url_submission" }.freeze
    COMPANIONS = {}.freeze
    DEFERRED = [ 681, 684, 679, 693, 696 ].freeze
    MARKER = "submission_audit_20261118".freeze

    def initialize(admin:, baseline:, apply: false, output: $stdout)
      raise Refused, "ADMIN_USER_ID must identify an active admin" unless admin&.admin? && admin.archived_at.nil? && !admin.clerk_id.to_s.start_with?("pending_")
      raise Refused, "baseline must have source production_export" unless baseline["source"] == "production_export"
      @cutoff = Time.iso8601(baseline.fetch("cutoff"))

      @admin, @apply, @output = admin, apply, output
      @baseline_library_ids = baseline["library_ids"]&.map { |id| Integer(id) }
      rows = baseline.fetch("blocks")
      @baseline = rows.index_by { |row| Integer(row.fetch("id")) }
      raise Refused, "duplicate baseline block ids" unless rows.size == @baseline.size
      @school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
    end

    def self.fixed_ids
      PRACTICE + TYPES.keys + COMPANIONS.keys + DEFERRED
    end

    # Reviews do not affect eligibility: UI-reviewed rows must remain exportable.
    def self.library_blocks(school:)
      curriculum = Curriculum.where(name: LIBRARY).sole
      ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: curriculum.id })
        .includes(:knowledge_check, lesson: { curriculum_module: { curriculum: :cohorts } }).order(:id)
        .select { |block| SubmissionAudit.candidate?(block, school: school) }
    rescue ActiveRecord::RecordNotFound, ActiveRecord::SoleRecordExceeded
      raise Refused, "library curriculum must exist and be unique"
    end

    def run
      decisions = decision_plan
      library_rows = @baseline.values.select { |row| row["curriculum_name"] == LIBRARY }
      library_ids = library_rows.map { |row| Integer(row.fetch("id")) }
      if @baseline_library_ids && @baseline_library_ids.sort != library_ids.sort
        raise Refused, "baseline library_ids disagree with library rows"
      end
      overlap = library_ids & self.class.fixed_ids
      raise Refused, "library ids overlap fixed decisions: #{overlap.sort.join(', ')}" if overlap.any?
      if @baseline.values.any? { |row| row["block_updated_at"].nil? || row["lesson_updated_at"].nil? }
        raise Refused, "baseline timestamps are required"
      end
      selected_ids = self.class.library_blocks(school: @school).map(&:id)
      raise Refused, "library baseline must equal the 82 curriculum-selected candidates" unless library_ids.size == 82 && library_ids.sort == selected_ids.sort
      library_ids.each { |id| decisions[id] = [ "practice", nil ] }
      @approved_ids = decisions.keys.to_set
      report = []
      decisions.group_by { |id, _| @baseline[id]&.fetch("lesson_id", nil) }.each do |lesson_id, entries|
        if lesson_id.nil?
          entries.each { |id, (action, type)| report << { id: id, action: action, target: type, status: "refused", reason: "baseline lesson missing" } }
          next
        end
        rows = []
        begin
          ApplicationRecord.transaction do
            lesson = Lesson.find(lesson_id)
            lesson.lock!("FOR NO KEY UPDATE")
            blocks = lesson.content_blocks.order(:position, :id).to_a
            # Reviews alone need no learner-exclusive lock. Content edits keep
            # the original exclusive locks, including all completion evidence.
            content_change = entries.any? { |_, (action, _)| action != "practice" }
            ContentBlock.lock_for_authoring!(blocks.map(&:id), exclusive: content_change ? blocks.map(&:id) : [])
            rows = entries.map do |id, (action, type)|
              block = blocks.find { |item| item.id == id }
              inspect_decision(block, action, type)
            end
            pending = rows.select { |row| row[:status] == "pending" }
            payload = block_payload(lesson, blocks, pending)
            projection = project_lesson(lesson, blocks, payload, content_change: pending.any? { |row| row[:action] != "practice" })
            rows.each do |row|
              row[:lesson_impact] = projection.except(:digests).merge(sibling_changes: projection[:sibling_changes].reject { |change| change[:id] == row[:id] })
            end
            if projection[:sibling_changes].any? { |change| !change[:approved] && change[:before][:effective_types] != change[:after][:effective_types] }
              raise Refused, "unapproved sibling effective submission type would change"
            end
            raise Refused, rows.filter_map { |row| row[:reason] if row[:status] == "refused" }.join("; ") if rows.any? { |row| row[:status] == "refused" }
            if blocks.size + pending.count { |row| row[:action] == "companion" } > ContentBlock::MAX_PER_LESSON
              raise Refused, "companion would exceed the lesson block limit"
            end
            if @apply && pending.any?
              if pending.any? { |row| row[:action] != "practice" }
                LessonBlockEditor.new(lesson: lesson, params: { base_updated_at: lesson.updated_at.iso8601(6), blocks: payload }, user: @admin).save!
                actual = lesson.content_blocks.reload.to_h { |block| [ block.id, SubmissionAudit.digest(block) ] }
                unless projection[:digests].all? { |id, digest| actual[id] == digest } && lesson.requires_submission == projection[:requires_submission][:after]
                  raise Refused, "saved content differs from the dry-run projection"
                end
              end
              pending.each do |row|
                next unless %w[practice companion].include?(row[:action])
                block = ContentBlock.find(row[:id])
                review = block.submission_audit_review || block.build_submission_audit_review
                review.update!(content_digest: SubmissionAudit.digest(block), reviewed_by: @admin)
              end
            end
            pending.each { |row| row[:status] = @apply ? "applied" : "dry_run" }
          end
        rescue Refused, LessonBlockEditor::Invalid, LessonBlockEditor::Stale, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound, ActiveRecord::StatementInvalid, ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionTimeoutError => error
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
    rescue Refused, ActiveRecord::StatementInvalid, ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionTimeoutError => error
      emit([ { status: "refused", reason: error.message } ])
    end

    private

    def decision_plan
      PRACTICE.to_h { |id| [ id, [ "practice", nil ] ] }
        .merge(TYPES.transform_values { |type| [ "type", type ] })
        .merge(COMPANIONS.transform_values { |type| [ "companion", type ] })
    end

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
        require_cutoff!(baseline.fetch("block_updated_at"), baseline.fetch("lesson_updated_at"))
        raise Refused, "invalid audit digest" unless digest.is_a?(String) && digest.match?(/\A[0-9a-f]{64}\z/)
        # Search globally: a moved marked companion must not cause a duplicate.
        companions = ContentBlock.where("metadata -> ? ->> 'source_id' = ?", MARKER, block.id.to_s).to_a
        raise Refused, "marked companion moved to another lesson" if companions.any? { |companion| companion.lesson_id != lesson.id }
        row[:companion] = companion_attributes(block, type) if action == "companion"
        if action == "companion" && companions.any?
          companion = companions.sole
          receipt = companion.metadata.fetch(MARKER)
          raise Refused, "companion or source changed" unless receipt["baseline_digest"] == digest && editor_flag_matches?(lesson) && original_content_matches?(block, digest) && companion.title == companion_attributes(block, type)[:title] && companion.body == companion_attributes(block, type)[:body] && companion.exercise? && companion.submission_type == type && companion.position == block.position + 1
          raise Refused, "companion source review missing or stale" unless block.submission_audit_review&.content_digest == SubmissionAudit.digest(block)
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
          require_cutoff!(block.updated_at, lesson.updated_at)
          if action == "type"
            raise Refused, "no longer a work block" unless block.student_work_block? && block.knowledge_check.nil?
            raise Refused, "conflicting learner submissions" if block.submissions.any? { |submission| submission.effective_submission_type != type }
          else
            raise Refused, "no longer an audit candidate" unless SubmissionAudit.candidate?(block, school: @school)
          end
          raise Refused, "companion source is already a work block" if action == "companion" && block.student_work_block?
          if action == "practice" && block.submission_audit_review&.content_digest == digest
            row[:status] = "already_applied"
          elsif action == "companion" && impact[:completed_learners].positive?
            raise Refused, "lesson has completed learners; reopening is not authorized"
          end
        end
      rescue Refused, KeyError, ArgumentError, ActiveRecord::SoleRecordExceeded => error
        row[:status], row[:reason] = "refused", error.message
      end
      row
    end

    def block_payload(lesson, blocks, pending)
      changes = pending.index_by { |row| row[:id] }
      blocks.flat_map do |block|
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
          [ item, companion_attributes(block, change[:target]).merge(client_id: "audit-#{block.id}", block_type: "exercise", metadata: { MARKER => { source_id: block.id, baseline_digest: @baseline.fetch(block.id).fetch("content_digest") } }) ]
        else
          [ item ]
        end
      end
    end

    def editor_flag_matches?(lesson)
      lesson.requires_submission == LessonBlockEditor.derived_requires_submission(lesson)
    end

    def original_content_matches?(block, digest)
      [ false, true ].any? do |required|
        Digest::SHA256.hexdigest([ block.title, block.body, block.block_type, block.submission_type, required ].to_json) == digest
      end
    end

    def companion_attributes(block, type)
      { title: "Exercise: #{block.title.presence || 'Your work'}",
        body: block.body.presence || "Describe the work learners should submit.", submission_type: type }
    end

    def require_cutoff!(*timestamps)
      raise Refused, "block or lesson updated after cutoff #{@cutoff.iso8601}" if timestamps.any? { |stamp| (stamp.is_a?(String) ? Time.iso8601(stamp) : stamp.to_time) > @cutoff }
    end

    def project_lesson(lesson, blocks, payload, content_change:)
      unless content_change
        return { requires_submission: { before: lesson.requires_submission, after: lesson.requires_submission }, sibling_changes: [], digests: {} }
      end

      # instantiate expects raw database enum integers, not the decoded strings
      # returned by attributes. dup preserves those attribute types.
      projected_lesson = lesson.dup
      projected_lesson.id = lesson.id
      projected = payload.map do |item|
        original = blocks.find { |block| block.id == item[:id] } if item[:id]
        block = original ? original.dup : ContentBlock.new
        block.assign_attributes(item.except(:client_id, :knowledge_check, :metadata))
        block.association(:knowledge_check).target = original&.knowledge_check
        block.association(:lesson).target = projected_lesson
        block
      end
      projected_lesson.association(:content_blocks).target = projected
      projected_lesson.requires_submission = LessonBlockEditor.derived_requires_submission(projected_lesson) if content_change
      changes = blocks.filter_map do |before|
        after = projected.find { |block| block.id == before.id }
        previous = { effective_types: effective_types(before), content_digest: SubmissionAudit.digest(before) }
        following = { effective_types: effective_types(after), content_digest: SubmissionAudit.digest(after) }
        next if previous == following
        { id: before.id, title: before.title, approved: @approved_ids.include?(before.id), before: previous, after: following }
      end
      { requires_submission: { before: lesson.requires_submission, after: projected_lesson.requires_submission }, sibling_changes: changes,
        digests: projected.select(&:id).to_h { |block| [ block.id, SubmissionAudit.digest(block) ] } }
    end

    def effective_types(block)
      { default: block.effective_submission_type, cohorts: SubmissionAudit.cohort_submissions(block, school: @school) }
    end
  end
end
