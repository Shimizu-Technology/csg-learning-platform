class GithubLessonStatus
  def self.for(enrollment:, lesson:, blocks:, submissions:)
    binding = GithubRepositoryAccess.binding_for(enrollment: enrollment, curriculum_module_id: lesson.module_id)
    return { state: "needs_repository" } unless binding

    scope = binding.curriculum_module_id ? "module" : "course"
    unless GithubRepositoryAccess.new(binding, client: nil).saved_verification_current?
      return { state: "needs_verification", scope: scope }
    end

    revisions = blocks.filter_map do |block|
      (submissions[block[:id]] || []).filter_map do |submission|
        revision = submission.github_revision
        next unless submission.submission_type_prework_github_sync? &&
          revision["version"] == 1 && submission.github_repository_id == binding.repository_id &&
          revision["repository_id"] == binding.repository_id &&
          binding.full_name.casecmp?(revision["repository_full_name"].to_s) &&
          submission.commit_sha.to_s.match?(/\A[0-9a-f]{40}\z/i)

        captured_at = Time.iso8601(revision["captured_at"].to_s).utc.iso8601(6)
        { block_id: block[:id], captured_at: captured_at, short_sha: submission.commit_sha.first(7) }
      rescue ArgumentError
        # A historical row without a valid capture time is not a saved snapshot.
        nil
      end.max_by { |revision| revision[:captured_at] }
    end

    { state: "verified", scope: scope, full_name: binding.full_name, revisions: revisions }
  end
end
