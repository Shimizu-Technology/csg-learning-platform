require "digest"

# Only the explicitly opted-in App path calls this service. Submission attempts
# are the revisions; no parallel grade model or reconstructed source history.
class GithubSubmittedRevisionSync
  MAX_SOURCE_BYTES = 256.kilobytes

  def initialize(access:, binding:, repository:)
    @access, @binding, @repository = access, binding, repository
  end

  def call(user:, enrollment:, curriculum_module_id:, exercise_blocks:, repo_data:, errors:, request_started_at:, synced_submission_ids: nil)
    sha = repo_data[:commit_hash]
    raise GithubAppClient::Error, "GitHub did not return an exact submitted commit" unless sha.to_s.match?(/\A[0-9a-f]{40,64}\z/i)

    matches = repo_data.fetch(:files).filter_map do |file|
      block = exercise_blocks.find { |row| row.filename.strip.casecmp?(file.fetch("name")) }
      next unless block && file["text"].is_a?(String)
      if file["text"].bytesize > MAX_SOURCE_BYTES
        errors << "#{file.fetch('name')}: source exceeds the 256 KiB capture limit; no revision imported"
        next
      end
      [ file, block ]
    end
    synced = 0
    enrollment.with_learning_write_guard(request_started_at: request_started_at) do
      # The same enrollment lock protects grade, manual create and curriculum
      # copy. Recheck the gate/access/window after provider I/O before writing.
      enrollment.association(:learner_extensions).reset
      enrollment.association(:learning_plan).reset
      enrollment.association(:cohort).reset
      current_cohort = enrollment.cohort
      current_cohort.cohort_module_submission_windows.reload
      windows = SubmissionWindowContext.new(enrollment)
      features = FeatureSwitches.for(cohort: current_cohort)
      raise GithubAppClient::Error, "GitHub App is disabled for this cohort" unless features["github_app"] == true
      raise GithubAppClient::Error, "GitHub sync is disabled for this course" unless features["github_sync"]
      raise GithubAppClient::Error, "Repository access requires an active learner enrollment" unless enrollment.active?

      @access.with_current_operation do
        # An override can be inserted while the default binding's own row stays
        # unchanged. Re-resolve selection under the same enrollment lock used
        # to create/rebind it, without trusting the batch's association cache.
        enrollment.association(:github_repository_bindings).reset
        current_binding = GithubRepositoryAccess.binding_for(enrollment: enrollment, curriculum_module_id: curriculum_module_id)
        unless current_binding&.id == @binding.id && current_binding.repository_id == @repository.fetch("id").to_i &&
            current_binding.full_name.casecmp?(@repository.fetch("full_name"))
          raise GithubRepositoryAccess::BindingChanged, "Repository binding changed during source sync; reload and sync again"
        end
        locked_ids = ContentBlock.lock_for_learner_writes!(matches.map { |_file, block| block.id }).to_set
        current_blocks = ContentBlock.where(id: locked_ids.to_a).includes(lesson: :curriculum_module).index_by(&:id)
        latest = Submission.where(enrollment: enrollment, user: user, content_block_id: locked_ids.to_a)
          .latest_attempts.index_by(&:content_block_id)
        matches.each do |file, block|
          next unless locked_ids.include?(block.id)
          block = current_blocks.fetch(block.id)
          unless block.lesson.module_id == curriculum_module_id && block.lesson.curriculum_module.curriculum_id == current_cohort.curriculum_id &&
              block.exercise_like? && block.github_sync_submission?(requires_github: true) && block.filename.to_s.strip.casecmp?(file.fetch("name"))
            errors << "#{file.fetch('name')}: exercise configuration changed during sync; sync again"
            next
          end
          if SubmissionWindowStatus.for_lesson(cohort: current_cohort, lesson: block.lesson, enrollment: enrollment, context: windows)[:submissions_closed]
            errors << "#{file.fetch('name')}: submission window closed during sync"
            next
          end

          previous = latest[block.id]
          # Also leave legacy rows untouched: identical text cannot establish
          # provenance for a past grade. Their limits remain explicit in UI.
          next if previous && previous.text == file.fetch("text")

          text = file.fetch("text")
          path = file.fetch("name")
          captured_at = Time.current
          # Append in the canonical created_at/id order even if the wall clock
          # moves backwards (or a historical row has a future timestamp). The
          # actual capture clock remains separate in provenance.
          created_at = [ captured_at, previous&.created_at ].compact.max
          repository_id = @repository.fetch("id").to_i
          revision_payload = {
            "version" => 1, "binding_id" => @binding.id, "repository_id" => repository_id,
            "repository_full_name" => @repository.fetch("full_name"), "paths" => [ path ],
            "content_digest" => Digest::SHA256.hexdigest(text), "source_bytes" => text.bytesize,
            "captured_at" => captured_at.iso8601(6)
          }
          if repo_data[:workflow_files].is_a?(Hash) && repo_data[:workflow_files].any?
            revision_payload["workflow_files"] = repo_data[:workflow_files]
          end
          submission = Submission.create!(user: user, enrollment: enrollment, content_block: block,
            submission_type: :prework_github_sync, text: text, commit_sha: sha, branch: repo_data[:branch],
            created_at: created_at,
            github_code_url: "https://github.com/#{@repository.fetch('full_name')}/blob/#{sha}/#{ERB::Util.url_encode(path).gsub('%2F', '/')}#L1-L#{text.count("\n") + 1}",
            github_repository_id: repository_id,
            num_submissions: (previous&.num_submissions || 0) + 1,
            github_revision: revision_payload)
          latest[block.id] = submission
          synced_submission_ids << submission.id if synced_submission_ids
          if features["github_issue_delivery_v2"] == true
            GithubIssueDeliveryPlanner.obsolete_pending!(
              enrollment_id: enrollment.id,
              content_block_id: block.id
            )
          end
          progress = Progress.find_or_initialize_by(enrollment: enrollment, content_block_id: block.id)
          progress.user = user
          progress.update!(status: :completed)
          synced += 1
        end
      end
      CourseCompletion.evaluate!(enrollment) if synced.positive? && features["certificates"] == true
    end
    { synced: synced, errors: errors }
  end
end
