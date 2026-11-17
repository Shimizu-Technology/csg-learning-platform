require "test_helper"

class SubmissionAuditHeuristicsTest < ActiveSupport::TestCase
  MATCHES = [ "Take screenshots", "Your submission is due", "Once you have submitted", "Create a GitHub repo",
    "Create a new repository", "Upload your file", "Turn it in", "Paste your link", "Deployed URL", "Send us your repo link",
    "Submit your work", "Push your changes", "Turn in your work", "Create a repo", "Deploy your site", "Share your link",
    "She submits tomorrow", "Submitting work", "Deployment link", "Deploying today", "Pushed your changes", "Pushes your changes", "Pushing your changes", "Uploaded your file", "Review your submissions", "Push to GitHub", "Push the repo" ].freeze
  NOISE = [ '<button type="submit">Continue</button>', "```sh\ngit push\n```", "We'll build on this", "Build tools like Vite",
    "Try `git push` locally", "~~~sh\ngit push\n~~~", "```sh\ngit push", "Read about variables", "Use push to add an item to the array", "Turn on push notifications", "Pushes changes" ].freeze

  MATCHES.each do |text|
    test "matches #{text}" do
      block = ContentBlock.new(block_type: :exercise, body: text)
      assert SubmissionAudit.asks_for_work?(block)
    end
  end
  NOISE.each do |text|
    test "ignores #{text}" do
      block = ContentBlock.new(block_type: :exercise, body: text)
      refute SubmissionAudit.asks_for_work?(block)
    end
  end
end
