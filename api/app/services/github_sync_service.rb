class GithubSyncService
  GITHUB_GRAPHQL_URL = "https://api.github.com/graphql".freeze

  def initialize(github_token:)
    @github_token = github_token
  end

  # Sync a single student's repo for a specific module's exercises.
  # Returns { synced: Integer, errors: Array<String> }
  def sync_student(user:, cohort:, curriculum_module:, repository_name_override: nil)
    errors = []
    repo_name = repository_name_override.presence || cohort.repository_name

    unless user.github_username.present?
      return { synced: 0, errors: [ "Student has no GitHub username" ] }
    end

    unless repo_name.present?
      return { synced: 0, errors: [ "No repository name configured for this module" ] }
    end

    exercise_blocks = ContentBlock
      .joins(:lesson)
      .where(lessons: { module_id: curriculum_module.id })
      .where(block_type: [ :exercise, :code_challenge ])
      .where.not(filename: [ nil, "" ])

    if exercise_blocks.empty?
      return { synced: 0, errors: [] }
    end

    target_filenames = exercise_blocks.filter_map { |b| b.filename&.strip }.uniq
    repo_data = fetch_exercise_files(user.github_username, repo_name, target_filenames)

    if repo_data[:error]
      return { synced: 0, errors: [ repo_data[:error] ] }
    end

    files = repo_data[:files]
    commit_hash = repo_data[:commit_hash]
    synced_count = 0

    files.each do |file|
      file_text = file["text"]
      next unless file_text.present?

      block = exercise_blocks.find { |b| b.filename&.downcase == file["name"]&.downcase }
      next unless block

      line_count = file_text.count("\n") + 1
      github_code_url = "https://github.com/#{user.github_username}/#{repo_name}/blob/#{commit_hash}/#{file['name']}#L1-L#{line_count}"

      existing = Submission.where(user: user, content_block_id: block.id).order(:created_at).last

      if existing
        if existing.text != file_text
          attrs = {
            text: file_text,
            github_code_url: github_code_url,
            num_submissions: existing.num_submissions + 1
          }

          passing = %w[A B C].include?(existing.grade)
          unless passing
            attrs[:grade] = nil
            attrs[:feedback] = nil
            attrs[:graded_at] = nil
            attrs[:graded_by_id] = nil
          end

          existing.update!(attrs)
          unless passing
            Progress.find_or_create_by!(user: user, content_block_id: block.id) do |p|
              p.status = :in_progress
            end
          end
          synced_count += 1
        end
      else
        Submission.create!(
          user: user,
          content_block_id: block.id,
          text: file_text,
          github_code_url: github_code_url,
          num_submissions: 1
        )
        Progress.find_or_create_by!(user: user, content_block_id: block.id) do |p|
          p.status = :in_progress
        end
        synced_count += 1
      end
    end

    { synced: synced_count, errors: errors }
  rescue StandardError => e
    { synced: 0, errors: [ "Sync error: #{e.message}" ] }
  end

  # Sync all active students in a cohort for a given module
  def sync_cohort_module(cohort:, curriculum_module:, repository_name_override: nil)
    results = {}

    cohort.enrollments.active.includes(:user).each do |enrollment|
      user = enrollment.user
      next unless user.github_username.present?

      result = sync_student(user: user, cohort: cohort, curriculum_module: curriculum_module, repository_name_override: repository_name_override)
      results[user.id] = result
    end

    results
  end

  private

  def fetch_exercise_files(owner, repo_name, filenames)
    file_fragments = filenames.each_with_index.map do |filename, idx|
      safe_expr = filename.gsub("\\") { "\\\\" }.gsub('"') { '\\"' }
      "file_#{idx}: object(expression: \"HEAD:#{safe_expr}\") { ... on Blob { text } }"
    end.join("\n        ")

    query = <<~GRAPHQL
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef {
            target {
              ... on Commit { oid }
            }
          }
          #{file_fragments}
        }
      }
    GRAPHQL

    response = HTTParty.post(
      GITHUB_GRAPHQL_URL,
      headers: {
        "Authorization" => "Bearer #{@github_token}",
        "Content-Type" => "application/json"
      },
      body: { query: query, variables: { owner: owner, name: repo_name } }.to_json,
      timeout: 15
    )

    unless response.success?
      return { error: "GitHub API error: HTTP #{response.code}", files: [], commit_hash: nil }
    end

    data = response.parsed_response["data"]

    unless data&.dig("repository")
      return { error: "Repository not found: #{owner}/#{repo_name}", files: [], commit_hash: nil }
    end

    repo = data["repository"]
    files = filenames.each_with_index.filter_map do |filename, idx|
      blob = repo["file_#{idx}"]
      next unless blob.is_a?(Hash) && blob["text"].present?

      { "name" => filename, "text" => blob["text"] }
    end

    {
      files: files,
      commit_hash: repo.dig("defaultBranchRef", "target", "oid"),
      error: nil
    }
  rescue StandardError => e
    { error: "GitHub request failed: #{e.message}", files: [], commit_hash: nil }
  end
end
