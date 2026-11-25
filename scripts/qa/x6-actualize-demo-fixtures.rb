#!/usr/bin/env ruby
# frozen_string_literal: true

ENV["QA_X6_DEMO"] = "1"
require_relative "boot"
require "digest"
require "json"
require "openssl"
require "optparse"

# Wave 3 X-6.10: Resettable synthetic "Prework Demo — synthetic" school &
# 10-minute rehearsal CLI.
#
# Safety boundaries:
# - Inherits scripts/qa/boot.rb guards: RAILS_ENV=test, local loopback Postgres,
#   database name matching /^csg_qa_[a-z0-9_]+$/, Net::HTTP blocked outside loopback.
# - Uses strictly invented names and @example.invalid addresses.
# - All simulated GitHub source, SHAs, check runs, webhooks, issues, and receipts
#   are explicitly labeled simulated and never contact real GitHub or send real email.
# - Runs REAL Rails services (GithubSyncService, GithubSubmittedRevisionSync,
#   GithubWebhookReceiver with HMAC-SHA256, GithubReconciliationService,
#   GithubGradeSuggestionEvaluator, GithubIssueDeliveryDrain,
#   CohortReleaseCommunications, ScheduledTick) against the local owned QA DB.

module X6ActualizeDemo
  COHORT_NAME = "Prework Demo — synthetic"
  CURRICULUM_NAME = "Prework Demo — synthetic"
  MODULE_NAME = "Prework Week 1 — Ruby Fundamentals"
  WORKFLOW_PATH = ".github/workflows/prework-checks.yml"
  WORKFLOW_YAML = <<~YAML
    name: Synthetic Prework Checks (Simulated)
    on: [push]
    jobs:
      prework-111:
        name: prework/111.rb
        runs-on: ubuntu-latest
      prework-112:
        name: prework/112.rb
        runs-on: ubuntu-latest
  YAML
  WORKFLOW_SHA256 = Digest::SHA256.hexdigest(WORKFLOW_YAML)
  METADATA_PATH = File.expand_path("../../.qa-local/x6-actualize-demo.json", __dir__)
  QA_STATE_PATH = File.expand_path("../../.qa-local/state.json", __dir__)

  SHAS = {
    program_initial: "1111111111111111111111111111111111110001",
    behind_initial: "2222222222222222222222222222222222220001",
    behind_fixed: "2222222222222222222222222222222222220002",
    behind_prior_redo: "2222222222222222222222222222222222220000",
    paused_initial: "5555555555555555555555555555555555550001"
  }.freeze

  PERSONA_CONFIGS = {
    "program" => {
      user_id: 3,
      github_user_id: "51003",
      github_login: "demo-program",
      installation_id: 88003,
      repository_id: 99003,
      repo_full_name: "demo-program/prework-exercises"
    },
    "behind" => {
      user_id: 4,
      github_user_id: "51004",
      github_login: "demo-behind",
      installation_id: 88004,
      repository_id: 99004,
      repo_full_name: "demo-behind/prework-exercises"
    },
    "paused" => {
      user_id: 5,
      github_user_id: "51005",
      github_login: "demo-paused",
      installation_id: 88005,
      repository_id: 99005,
      repo_full_name: "demo-paused/prework-exercises"
    }
  }.freeze

  SOURCES = {
    ex111_passing: <<~RUBY,
      # Synthetic exercise 111.rb — Greeting Badge (simulated commit)
      def greeting_badge(name)
        cleaned = name.to_s.strip
        cleaned.empty? ? "Hello, Guest!" : "Hello, \#{cleaned}!"
      end
    RUBY
    ex111_redo_prior: <<~RUBY,
      # Synthetic exercise 111.rb — Initial draft with nil edge case (simulated)
      def greeting_badge(name)
        "Hello, \#{name.strip}!"
      end
    RUBY
    ex112_buggy: <<~RUBY,
      # Synthetic exercise 112.rb — Score Summary (simulated buggy edge case)
      def score_summary(scores)
        # Bug: divides by zero when scores is empty
        scores.sum / scores.length
      end
    RUBY
    ex112_fixed: <<~RUBY,
      # Synthetic exercise 112.rb — Score Summary (simulated corrected resubmission)
      def score_summary(scores)
        return 0 if scores.nil? || scores.empty?

        (scores.sum.to_f / scores.length).round(1)
      end
    RUBY
    ex113_unsubmitted: <<~RUBY,
      # Synthetic exercise 113.rb — Daily Streaks (simulated push)
      def daily_streaks(days)
        Array(days).count { |d| d == true }
      end
    RUBY
    paused_code: <<~RUBY
      # Synthetic paused learner code — must be refused by active-enrollment guards
      def greeting_badge(name)
        "Paused \#{name}"
      end
    RUBY
  }.freeze

  class << self
    def run!(argv)
      cmd = argv.shift || "setup"
      case cmd
      when "setup", "reset"
        meta = setup!
        print_summary(meta)
      when "sync"
        run_sync!(argv)
      when "send_webhook"
        run_send_webhook!(argv)
      when "reconcile"
        run_reconcile!(argv)
      when "drain_issues"
        run_drain_issues!(argv)
      when "push_fix"
        run_push_fix!(argv)
      when "simulate_outage"
        run_simulate_outage!(argv)
      when "recover_outage"
        run_recover_outage!
      when "preview_release"
        run_preview_release!
      when "close_window"
        run_window_toggle!(closed: true)
      when "open_window"
        run_window_toggle!(closed: false)
      when "status"
        puts JSON.pretty_generate(current_status)
      else
        abort <<~USAGE
          Unknown command: #{cmd}
          Usage:
            ruby scripts/qa/x6-actualize-demo-fixtures.rb <command> [options]

          Commands:
            setup | reset       Build or cleanly reset "Prework Demo — synthetic"
            sync [persona]      Run real GithubSyncService (all active learners or program|behind|paused)
            send_webhook        Deliver signed HMAC-SHA256 webhook through GithubWebhookReceiver
            reconcile           Run real GithubReconciliationService (--force-due to clear interval)
            drain_issues        Run real GithubIssueDeliveryDrain
            push_fix            Update simulated repo commit SHA + source (--persona behind --exercise 112.rb)
            simulate_outage     Enable simulated provider outage (--mode transient|issue_transient|issue_failed|timeout_after_create)
            recover_outage      Clear simulated provider outage
            preview_release     Show CohortReleaseCommunications projection + ScheduledTick dry-run
            close_window        Close Week 1 submission window on the demo module
            open_window         Reopen Week 1 submission window on the demo module
            status              Print JSON snapshot of submissions, checks, suggestions, deliveries, simulated issues
        USAGE
      end
    end

    def cleanup_existing!
      existing_cohorts = Cohort.where(name: COHORT_NAME).to_a
      existing_curricula = Curriculum.where(name: CURRICULUM_NAME).to_a

      existing_cohorts.each do |cohort|
        enrollment_ids = Enrollment.where(cohort_id: cohort.id).pluck(:id)
        if enrollment_ids.any?
          submission_ids = Submission.where(enrollment_id: enrollment_ids).pluck(:id)
          GithubIssueDelivery.where(enrollment_id: enrollment_ids).delete_all
          SubmissionGradeSuggestion.where(enrollment_id: enrollment_ids).delete_all
          GithubCheckRun.where(submission_id: submission_ids).delete_all if submission_ids.any?
          SubmissionCriterionResult.where(submission_id: submission_ids).delete_all if submission_ids.any?
          Submission.where(id: submission_ids).delete_all if submission_ids.any?
          Progress.where(enrollment_id: enrollment_ids).delete_all
          binding_ids = GithubRepositoryBinding.where(enrollment_id: enrollment_ids).pluck(:id)
          GithubReconciliationState.where(github_repository_binding_id: binding_ids).delete_all if binding_ids.any?
          GithubRepositoryBinding.where(id: binding_ids).delete_all if binding_ids.any?
          ModuleAssignment.where(enrollment_id: enrollment_ids).delete_all
          LessonAssignment.where(enrollment_id: enrollment_ids).delete_all
          LearningPlan.where(enrollment_id: enrollment_ids).delete_all
          LearnerExtension.where(enrollment_id: enrollment_ids).delete_all
          ScheduledNotificationAttempt.where("key LIKE ANY (ARRAY[?])", enrollment_ids.flat_map { |eid| [ "daily_unlock/#{eid}/%", "daily_unlock_digest/#{eid}/%" ] }).delete_all
          Enrollment.where(id: enrollment_ids).delete_all
        end
        GithubAppInstallation.where(cohort_id: cohort.id).delete_all
        CohortModuleSubmissionWindow.where(cohort_id: cohort.id).delete_all
        CohortInstructorAssignment.where(cohort_id: cohort.id).delete_all
        ActivityEvent.where(cohort_id: cohort.id).delete_all
        Announcement.where(cohort_id: cohort.id).delete_all
        cohort.destroy!
      end

      existing_curricula.each do |curriculum|
        lesson_ids = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curriculum.id }).pluck(:id)
        block_ids = ContentBlock.where(lesson_id: lesson_ids).pluck(:id)
        ObjectiveAlignment.where(lesson_id: lesson_ids).delete_all if lesson_ids.any?
        ExerciseCheckPolicy.where(content_block_id: block_ids).delete_all if block_ids.any?
        LearningObjective.where(curriculum_id: curriculum.id).delete_all
        Rubric.where(curriculum_id: curriculum.id).destroy_all
        curriculum.destroy!
      end

      FeedbackSnippet.where(title: "Handle empty and negative inputs explicitly").delete_all
      repo_ids = PERSONA_CONFIGS.values.map { |c| c[:repository_id] }
      inst_ids = PERSONA_CONFIGS.values.map { |c| c[:installation_id] }
      GithubWebhookDelivery.where(repository_id: repo_ids).or(GithubWebhookDelivery.where(installation_id: inst_ids)).delete_all
    end

    # Synthetic class files and one private folder file each way, so Files and
    # Resources open populated. Keys are invented; no object storage is touched.
    def seed_cohort_files!(cohort, instructor, student)
      seeded = [
        { title: "Week 1 Ruby Slides", filename: "week-1-ruby-slides.pdf", folder: "Slides", visibility: "students", uploaded_by: instructor },
        { title: "Job Search Plan Template", filename: "job-search-plan-template.docx", folder: "Career & Job Search", visibility: "students", uploaded_by: instructor },
        { title: "Instructor Week 1 Notes", filename: "week-1-instructor-notes.pdf", folder: "Slides", visibility: "staff_only", uploaded_by: instructor },
        { title: "Job Search Plan", filename: "student-one-job-search-plan.docx", folder: "Job Search & Career", visibility: "students", uploaded_by: instructor, student: student },
        { title: "Resume Draft v1", filename: "resume-draft-v1.pdf", folder: "Resumes & Portfolio", visibility: "students", uploaded_by: student, student: student }
      ].map do |attributes|
        owner = attributes[:student] ? "student_#{attributes[:student].id}" : "shared"
        token = Digest::SHA256.hexdigest("#{cohort.id}:#{attributes[:filename]}")[0, 16]
        cohort.cohort_files.create!(
          **attributes, description: "Synthetic demo file",
          content_type: CohortFile.normalized_content_type(attributes[:filename], ""), file_size: 48_000,
          s3_key: "cohort_files/cohort_#{cohort.id}/#{owner}/synthetic-#{token}/#{attributes[:filename]}",
          upload_key: "cohort_file_uploads/cohort_#{cohort.id}/synthetic-#{token}/#{attributes[:filename]}",
          upload_expires_at: 1.day.ago, ready: true
        ).tap { |file| file.update_columns(created_at: 1.day.ago, ready_at: 1.day.ago) }
      end
      seeded.to_h { |file| [ file.filename, file.id ] }
    end

    def setup!
      admin = User.find(1)
      instructor = User.find(2)
      program_student = User.find(3)
      behind_student = User.find(4)
      paused_student = User.find(5)

      metadata = nil
      ActiveRecord::Base.transaction do
        cleanup_existing!

        # Enable school-level X-6 switches; base QA cohorts remain un-opted-in (default Off).
        SchoolSetting.current.update!(
          features: SchoolSetting.current.features.merge(
            "github_sync" => true,
            "github_app" => true,
            "github_grade_suggestions" => true,
            "github_webhooks" => true,
            "github_reconciliation" => true,
            "github_issue_delivery_v2" => true,
            "student_experience_v2" => true
          )
        )

        # Verify synthetic GitHub identities for personas 3, 4, 5.
        PERSONA_CONFIGS.each_value do |cfg|
          user = User.find(cfg[:user_id])
          user.update!(github_username: cfg[:github_login])
          user.record_verified_github_identity!(id: cfg[:github_user_id], login: cfg[:github_login])
        end

        curriculum = Curriculum.create!(name: CURRICULUM_NAME, status: :active)
        rubric = curriculum.rubrics.create!(
          title: "Ruby Prework Clarity Rubric",
          description: "Synthetic grading rubric for the Actualize prework demo.",
          rubric_criteria_attributes: [
            {
              title: "Handles edge cases cleanly",
              description: "Guards nil, empty, and boundary inputs without crashing.",
              position: 0
            }
          ]
        )

        FeedbackSnippet.create!(
          created_by: instructor,
          title: "Handle empty and negative inputs explicitly",
          body: "Guard against empty arrays and nil values at the top of the method before dividing or calling string helpers.",
          usage_count: 3,
          active: true
        )

        objective = curriculum.learning_objectives.create!(
          code: "PREWORK-RUBY-1",
          title: "Write edge-case-safe Ruby methods",
          success_criteria: "Implements clean Ruby methods that handle blank strings, nil, and empty arrays without runtime errors.",
          position: 0,
          active: true
        )

        prework_mod = curriculum.modules.create!(
          name: MODULE_NAME,
          position: 0,
          day_offset: 0,
          module_type: :prework,
          schedule_days: "weekdays"
        )

        # Day 1 lesson (unlocked immediately): 3 invented Ruby exercises.
        day1_lesson = prework_mod.lessons.create!(
          title: "Day 1: Ruby Methods & Edge Cases",
          position: 0,
          release_day: 0,
          required: true,
          requires_submission: true
        )

        day1_lesson.content_blocks.create!(
          block_type: :text,
          position: 0,
          title: "Prework Setup (Simulated Demo)",
          body: <<~MD
            # Synthetic Prework Walkthrough

            Push each Ruby exercise to your `prework-exercises` repository on `main`.
            Instructor **Sync GitHub** and hourly reconciliation capture your exact commit SHA,
            exercise checks suggest a grade, and your instructor confirms every final A/B/C/R grade.
          MD
        )

        ex111 = day1_lesson.content_blocks.create!(
          block_type: :exercise,
          position: 1,
          title: "Greeting Badge (111.rb)",
          filename: "111.rb",
          submission_type: :prework_github_sync,
          rubric: rubric,
          body: "Write `greeting_badge(name)` in `111.rb`. Trim whitespace and return `\"Hello, Guest!\"` when blank or nil.",
          solution: SOURCES[:ex111_passing],
          metadata: { "language" => "ruby", "simulated_demo" => true }
        )

        ex112 = day1_lesson.content_blocks.create!(
          block_type: :exercise,
          position: 2,
          title: "Score Summary (112.rb)",
          filename: "112.rb",
          submission_type: :prework_github_sync,
          rubric: rubric,
          body: "Write `score_summary(scores)` in `112.rb`. Return `0` for an empty or nil array; otherwise return the average rounded to 1 decimal.",
          solution: SOURCES[:ex112_fixed],
          metadata: { "language" => "ruby", "simulated_demo" => true }
        )

        ex113 = day1_lesson.content_blocks.create!(
          block_type: :exercise,
          position: 3,
          title: "Daily Streaks (113.rb)",
          filename: "113.rb",
          submission_type: :prework_github_sync,
          body: "Write `daily_streaks(days)` in `113.rb` to count completed practice days. Intentionally has no automated check policy configured yet.",
          solution: SOURCES[:ex113_unsubmitted],
          metadata: { "language" => "ruby", "simulated_demo" => true }
        )

        # Upcoming lesson releasing on a future school day so Release Communications
        # shows a realistic upcoming daily unlock email preview & recipient count.
        today = LearningCalendar.today
        start_date = today - 7
        # 7 calendar days has at most 6 weekdays, so release_day 8 is always in the future
        # and lands cleanly in Week 2 (separate from Week 1 submission-window checks).
        day2_lesson = prework_mod.lessons.create!(
          title: "Day 2: Arrays & Enumerable Practice",
          position: 0,
          release_day: 8,
          required: true,
          requires_submission: false
        )
        day2_lesson.content_blocks.create!(
          block_type: :text,
          position: 0,
          title: "Upcoming Lesson Preview",
          body: "Synthetic lesson scheduled to unlock on the next school day for the release communication preview."
        )

        ObjectiveAlignment.create!(learning_objective: objective, lesson: day1_lesson, content_block: ex111, position: 0)
        ObjectiveAlignment.create!(learning_objective: objective, lesson: day1_lesson, content_block: ex112, position: 1)

        policy_111 = ExerciseCheckPolicy.create_version!(
          content_block: ex111,
          required_checks: [ "prework/111.rb" ],
          allowed_app_slugs: [ "github-actions" ],
          allowed_branch: "main",
          expected_workflow_path: WORKFLOW_PATH,
          expected_workflow_sha: WORKFLOW_SHA256,
          created_by: admin
        )

        policy_112 = ExerciseCheckPolicy.create_version!(
          content_block: ex112,
          required_checks: [ "prework/112.rb" ],
          allowed_app_slugs: [ "github-actions" ],
          allowed_branch: "main",
          expected_workflow_path: WORKFLOW_PATH,
          expected_workflow_sha: WORKFLOW_SHA256,
          created_by: admin
        )

        cohort = Cohort.create!(
          name: COHORT_NAME,
          curriculum: curriculum,
          start_date: start_date,
          end_date: today + 35,
          status: :active,
          cohort_type: :bootcamp,
          course_delivery: "program",
          repository_name: "prework-exercises",
          settings: {
            "features" => {
              "github_sync" => true,
              "github_app" => true,
              "github_grade_suggestions" => true,
              "github_webhooks" => true,
              "github_reconciliation" => true,
              "github_issue_delivery_v2" => true,
              "student_experience_v2" => true
            },
            "module_github_config" => {
              prework_mod.id.to_s => {
                "requires_github" => true,
                "repository_name" => "prework-exercises"
              }
            }
          }
        )
        cohort.instructors << instructor

        enrollments = {}
        bindings = {}
        installations = {}

        [ [ "program", program_student, :active ], [ "behind", behind_student, :active ], [ "paused", paused_student, :paused ] ].each do |key, user, status|
          cfg = PERSONA_CONFIGS.fetch(key)
          enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
          enrollment.assign_cohort_content_defaults!
          enrollment.update!(status: :paused) if status == :paused
          enrollments[key] = enrollment

          inst = cohort.github_app_installations.create!(
            app_id: 12345,
            installation_id: cfg[:installation_id],
            account_id: cfg[:github_user_id].to_i,
            account_login: cfg[:github_login],
            account_type: "User",
            repository_selection: "selected",
            permissions: { "contents" => "read", "checks" => "read", "metadata" => "read", "issues" => "write" },
            connection_state: "connected",
            connected_at: 10.minutes.ago,
            checked_at: 10.minutes.ago
          )
          installations[key] = inst

          bind = enrollment.github_repository_bindings.create!(
            github_app_installation: inst,
            curriculum_module: prework_mod,
            full_name: cfg[:repo_full_name],
            repository_id: cfg[:repository_id],
            github_user_id: cfg[:github_user_id],
            github_username: cfg[:github_login],
            verification_state: "verified",
            verified_at: 10.minutes.ago,
            checked_at: 10.minutes.ago
          )
          bindings[key] = bind
        end

        # Give Behind student (persona 4) one pre-existing open Redo on 111.rb so
        # Today / My Work / Insights always show a real remaining Redo elsewhere
        # even after 112.rb is corrected and passes!
        prior_redo_sub = Submission.create!(
          user: behind_student,
          enrollment: enrollments["behind"],
          content_block: ex111,
          submission_type: :prework_github_sync,
          text: SOURCES[:ex111_redo_prior],
          commit_sha: SHAS[:behind_prior_redo],
          branch: "main",
          github_repository_id: PERSONA_CONFIGS["behind"][:repository_id],
          github_code_url: "https://github.com/demo-behind/prework-exercises/blob/#{SHAS[:behind_prior_redo]}/111.rb#L1-L4",
          grade: "R",
          feedback: "Handle nil names before calling strip so greeting_badge(nil) returns \"Hello, Guest!\".",
          graded_by_id: instructor.id,
          graded_at: 1.day.ago,
          num_submissions: 1,
          created_at: 1.day.ago,
          updated_at: 1.day.ago,
          github_revision: {
            "version" => 1,
            "binding_id" => bindings["behind"].id,
            "repository_id" => PERSONA_CONFIGS["behind"][:repository_id],
            "repository_full_name" => PERSONA_CONFIGS["behind"][:repo_full_name],
            "paths" => [ "111.rb" ],
            "content_digest" => Digest::SHA256.hexdigest(SOURCES[:ex111_redo_prior]),
            "source_bytes" => SOURCES[:ex111_redo_prior].bytesize,
            "captured_at" => 1.day.ago.iso8601(6),
            "workflow_files" => {
              WORKFLOW_PATH => {
                "present" => true,
                "oid" => Digest::SHA1.hexdigest("blob #{WORKFLOW_YAML.bytesize}\0#{WORKFLOW_YAML}"),
                "sha256" => WORKFLOW_SHA256
              }
            }
          }
        )
        Progress.create!(
          enrollment: enrollments["behind"],
          user: behind_student,
          content_block: ex111,
          status: :in_progress
        )

        # Initialize simulated local provider state file.
        workflow_entry = {
          "text" => WORKFLOW_YAML,
          "oid" => Digest::SHA1.hexdigest("blob #{WORKFLOW_YAML.bytesize}\0#{WORKFLOW_YAML}"),
          "sha256" => WORKFLOW_SHA256
        }

        X6DemoFakeGithubClient.reset_state!(
          "installations" => PERSONA_CONFIGS.values.each_with_object({}) do |cfg, hash|
            hash[cfg[:installation_id].to_s] = {
              "id" => cfg[:installation_id],
              "app_id" => 12345,
              "account" => {
                "id" => cfg[:github_user_id].to_i,
                "login" => cfg[:github_login],
                "type" => "User"
              },
              "repository_selection" => "selected",
              "permissions" => { "contents" => "read", "checks" => "read", "metadata" => "read", "issues" => "write" }
            }
          end,
          "repositories" => {
            PERSONA_CONFIGS["program"][:repository_id].to_s => {
              "id" => PERSONA_CONFIGS["program"][:repository_id],
              "full_name" => PERSONA_CONFIGS["program"][:repo_full_name],
              "owner" => { "id" => 51003, "login" => "demo-program", "type" => "User" },
              "fork" => false,
              "branch" => "main",
              "head_sha" => SHAS[:program_initial],
              "committed_at" => 2.minutes.ago.iso8601,
              "commits" => {
                SHAS[:program_initial] => {
                  "files" => {
                    "111.rb" => SOURCES[:ex111_passing]
                  },
                  "workflow_files" => { WORKFLOW_PATH => workflow_entry },
                  "checks" => [
                    build_check_run_hash(
                      external_id: 911101,
                      name: "prework/111.rb",
                      sha: SHAS[:program_initial],
                      repo_full_name: PERSONA_CONFIGS["program"][:repo_full_name],
                      status: "completed",
                      conclusion: "success"
                    )
                  ]
                }
              }
            },
            PERSONA_CONFIGS["behind"][:repository_id].to_s => {
              "id" => PERSONA_CONFIGS["behind"][:repository_id],
              "full_name" => PERSONA_CONFIGS["behind"][:repo_full_name],
              "owner" => { "id" => 51004, "login" => "demo-behind", "type" => "User" },
              "fork" => false,
              "branch" => "main",
              "head_sha" => SHAS[:behind_initial],
              "committed_at" => 2.minutes.ago.iso8601,
              "commits" => {
                SHAS[:behind_initial] => {
                  "files" => {
                    "111.rb" => SOURCES[:ex111_redo_prior],
                    "112.rb" => SOURCES[:ex112_buggy]
                  },
                  "workflow_files" => { WORKFLOW_PATH => workflow_entry },
                  "checks" => [
                    build_check_run_hash(
                      external_id: 911201,
                      name: "prework/112.rb",
                      sha: SHAS[:behind_initial],
                      repo_full_name: PERSONA_CONFIGS["behind"][:repo_full_name],
                      status: "completed",
                      conclusion: "failure"
                    )
                  ]
                },
                SHAS[:behind_fixed] => {
                  "files" => {
                    "111.rb" => SOURCES[:ex111_redo_prior],
                    "112.rb" => SOURCES[:ex112_fixed]
                  },
                  "workflow_files" => { WORKFLOW_PATH => workflow_entry },
                  "checks" => [
                    build_check_run_hash(
                      external_id: 911202,
                      name: "prework/112.rb",
                      sha: SHAS[:behind_fixed],
                      repo_full_name: PERSONA_CONFIGS["behind"][:repo_full_name],
                      status: "completed",
                      conclusion: "success"
                    )
                  ]
                }
              }
            },
            PERSONA_CONFIGS["paused"][:repository_id].to_s => {
              "id" => PERSONA_CONFIGS["paused"][:repository_id],
              "full_name" => PERSONA_CONFIGS["paused"][:repo_full_name],
              "owner" => { "id" => 51005, "login" => "demo-paused", "type" => "User" },
              "fork" => false,
              "branch" => "main",
              "head_sha" => SHAS[:paused_initial],
              "committed_at" => 2.minutes.ago.iso8601,
              "commits" => {
                SHAS[:paused_initial] => {
                  "files" => { "111.rb" => SOURCES[:paused_code] },
                  "workflow_files" => { WORKFLOW_PATH => workflow_entry },
                  "checks" => []
                }
              }
            }
          }
        )

        cohort_files = seed_cohort_files!(cohort, instructor, program_student)

        web_port = read_web_port
        metadata = {
          simulated: true,
          database: ActiveRecord::Base.connection_db_config.database,
          curriculum_id: curriculum.id,
          cohort_id: cohort.id,
          cohort_name: cohort.name,
          module_id: prework_mod.id,
          lesson_id: day1_lesson.id,
          upcoming_lesson_id: day2_lesson.id,
          rubric_id: rubric.id,
          rubric_criterion_id: rubric.rubric_criteria.first.id,
          objective_id: objective.id,
          objective_code: objective.code,
          exercises: {
            ex111: { id: ex111.id, filename: ex111.filename, title: ex111.title, policy_id: policy_111.id },
            ex112: { id: ex112.id, filename: ex112.filename, title: ex112.title, policy_id: policy_112.id },
            ex113: { id: ex113.id, filename: ex113.filename, title: ex113.title, policy_id: nil }
          },
          prior_redo_submission_id: prior_redo_sub.id,
          cohort_files: cohort_files,
          shas: SHAS,
          workflow_path: WORKFLOW_PATH,
          workflow_sha256: WORKFLOW_SHA256,
          webhook_secret: GithubAppCredentials.webhook_secret,
          personas: {
            admin: { id: 1, role: "admin", url: "http://127.0.0.1:#{web_port}/admin/cohorts/#{cohort.id}?qa_user=1" },
            instructor: { id: 2, role: "instructor", url: "http://127.0.0.1:#{web_port}/admin/cohorts/#{cohort.id}/modules/#{prework_mod.id}/grading?qa_user=2" },
            program: {
              id: 3, role: "student", enrollment_id: enrollments["program"].id, binding_id: bindings["program"].id,
              installation_id: PERSONA_CONFIGS["program"][:installation_id], repository_id: PERSONA_CONFIGS["program"][:repository_id],
              repo_full_name: PERSONA_CONFIGS["program"][:repo_full_name],
              url: "http://127.0.0.1:#{web_port}/lessons/#{day1_lesson.id}?cohort_id=#{cohort.id}&qa_user=3"
            },
            behind: {
              id: 4, role: "student", enrollment_id: enrollments["behind"].id, binding_id: bindings["behind"].id,
              installation_id: PERSONA_CONFIGS["behind"][:installation_id], repository_id: PERSONA_CONFIGS["behind"][:repository_id],
              repo_full_name: PERSONA_CONFIGS["behind"][:repo_full_name],
              url: "http://127.0.0.1:#{web_port}/lessons/#{day1_lesson.id}?cohort_id=#{cohort.id}&qa_user=4"
            },
            paused: {
              id: 5, role: "student", enrollment_id: enrollments["paused"].id, binding_id: bindings["paused"].id,
              installation_id: PERSONA_CONFIGS["paused"][:installation_id], repository_id: PERSONA_CONFIGS["paused"][:repository_id],
              repo_full_name: PERSONA_CONFIGS["paused"][:repo_full_name],
              url: "http://127.0.0.1:#{web_port}/dashboard?cohort_id=#{cohort.id}&qa_user=5"
            },
            self_paced: { id: 6, role: "student", unrelated: true, url: "http://127.0.0.1:#{web_port}/dashboard?qa_user=6" },
            new_student: { id: 7, role: "student", unrelated: true, url: "http://127.0.0.1:#{web_port}/dashboard?qa_user=7" },
            alumni: { id: 8, role: "student", unrelated: true, url: "http://127.0.0.1:#{web_port}/dashboard?qa_user=8" }
          },
          expected_initial_counts: {
            active_learners: 2,
            paused_learners: 1,
            day1_exercises: 3,
            seeded_submissions: 1,
            seeded_open_redos: 1
          },
          reset_command: "cd api && DATABASE_URL=#{ENV.fetch('DATABASE_URL')} QA_X6_DEMO=1 bundle exec ruby ../scripts/qa/x6-actualize-demo-fixtures.rb reset"
        }
      end

      FileUtils.mkdir_p(File.dirname(METADATA_PATH))
      File.write(METADATA_PATH, JSON.pretty_generate(metadata))
      metadata
    end

    def build_check_run_hash(external_id:, name:, sha:, repo_full_name:, status:, conclusion:, app_slug: "github-actions", workflow_path: WORKFLOW_PATH, check_suite_id: 7001, started_at: nil, completed_at: nil)
      started = started_at || (Time.current - 45.seconds).utc.iso8601
      completed = status == "completed" ? (completed_at || (Time.current - 5.seconds).utc.iso8601) : nil
      {
        "id" => external_id,
        "name" => name,
        "head_sha" => sha,
        "status" => status,
        "conclusion" => conclusion,
        "details_url" => "https://example.invalid/simulated-github/#{repo_full_name}/runs/#{external_id}",
        "started_at" => started,
        "completed_at" => completed,
        "workflow_path" => workflow_path,
        "app" => { "slug" => app_slug },
        "check_suite" => { "id" => check_suite_id, "app" => { "name" => "Simulated GitHub Actions" }, "workflow_path" => workflow_path }
      }
    end

    def run_sync!(argv)
      meta = load_metadata!
      cohort = Cohort.find(meta.fetch("cohort_id"))
      mod = CurriculumModule.find(meta.fetch("module_id"))
      service = GithubSyncService.new(github_token: nil)
      persona = argv.first

      result = if persona.present?
        user_id = meta.dig("personas", persona, "id")
        abort "Unknown persona: #{persona}" unless user_id
        service.sync_student(user: User.find(user_id), cohort: cohort, curriculum_module: mod)
      else
        service.sync_cohort_module(cohort: cohort, curriculum_module: mod)
      end

      puts JSON.pretty_generate({ simulated: true, action: "sync", persona: persona || "all", result: result })
    end

    def run_send_webhook!(argv)
      meta = load_metadata!
      opts = {
        persona: "program",
        event: "check_run",
        action: "completed",
        check: "prework/111.rb",
        status: "completed",
        conclusion: "success",
        app_slug: "github-actions",
        workflow_path: WORKFLOW_PATH,
        check_suite_id: 7001,
        external_id: 920001,
        delivery_id: "sim-delivery-#{SecureRandom.hex(6)}",
        sha: nil,
        evaluate: false,
        tamper_signature: false
      }

      OptionParser.new do |o|
        o.on("--persona VAL") { |v| opts[:persona] = v }
        o.on("--event VAL") { |v| opts[:event] = v }
        o.on("--action VAL") { |v| opts[:action] = v }
        o.on("--check VAL") { |v| opts[:check] = v }
        o.on("--status VAL") { |v| opts[:status] = v }
        o.on("--conclusion VAL") { |v| opts[:conclusion] = v.empty? ? nil : v }
        o.on("--app-slug VAL") { |v| opts[:app_slug] = v }
        o.on("--workflow-path VAL") { |v| opts[:workflow_path] = v }
        o.on("--check-suite-id VAL", Integer) { |v| opts[:check_suite_id] = v }
        o.on("--external-id VAL", Integer) { |v| opts[:external_id] = v }
        o.on("--delivery-id VAL") { |v| opts[:delivery_id] = v }
        o.on("--sha VAL") { |v| opts[:sha] = v }
        o.on("--evaluate") { opts[:evaluate] = true }
        o.on("--tamper-signature") { opts[:tamper_signature] = true }
      end.parse!(argv)

      p_meta = meta.dig("personas", opts[:persona])
      abort "Unknown persona: #{opts[:persona]}" unless p_meta && p_meta["repository_id"]

      sha = opts[:sha] || X6DemoFakeGithubClient.with_state { |s| s.dig("repositories", p_meta["repository_id"].to_s, "head_sha") }
      payload = case opts[:event]
      when "check_run"
        {
          "action" => opts[:action],
          "installation" => { "id" => p_meta["installation_id"] },
          "repository" => { "id" => p_meta["repository_id"], "full_name" => p_meta["repo_full_name"] },
          "check_run" => build_check_run_hash(
            external_id: opts[:external_id],
            name: opts[:check],
            sha: sha,
            repo_full_name: p_meta["repo_full_name"],
            status: opts[:status],
            conclusion: opts[:conclusion],
            app_slug: opts[:app_slug],
            workflow_path: opts[:workflow_path],
            check_suite_id: opts[:check_suite_id]
          )
        }
      when "push"
        {
          "ref" => "refs/heads/main",
          "before" => "0" * 40,
          "after" => sha,
          "deleted" => false,
          "installation" => { "id" => p_meta["installation_id"] },
          "repository" => { "id" => p_meta["repository_id"], "full_name" => p_meta["repo_full_name"], "default_branch" => "main" }
        }
      else
        abort "Unsupported simulated event: #{opts[:event]}"
      end

      raw_body = JSON.generate(payload)
      secret = GithubAppCredentials.webhook_secret
      signature = if opts[:tamper_signature]
        "sha256=#{'0' * 64}"
      else
        "sha256=#{OpenSSL::HMAC.hexdigest('SHA256', secret.b, raw_body.b)}"
      end

      headers = {
        "X-Hub-Signature-256" => signature,
        "X-GitHub-Delivery" => opts[:delivery_id],
        "X-GitHub-Event" => opts[:event]
      }
      result = GithubWebhookReceiver.new(raw_body: raw_body, headers: headers).call

      evaluated_ids = []
      if opts[:evaluate] && result.status == :ok && opts[:event] == "check_run"
        Submission.where(enrollment_id: p_meta["enrollment_id"], commit_sha: sha).find_each do |sub|
          suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
          evaluated_ids << { submission_id: sub.id, outcome: suggestion&.outcome, reason_code: suggestion&.reason_code } if suggestion
        end
      end

      puts JSON.pretty_generate(
        simulated: true,
        action: "send_webhook",
        http_status: result.status,
        body: result.body,
        evaluated: evaluated_ids
      )
    end

    def run_reconcile!(argv)
      force_due = argv.include?("--force-due")
      meta = load_metadata!
      if force_due
        binding_ids = meta["personas"].values.filter_map { |p| p["binding_id"] }
        GithubReconciliationState.where(github_repository_binding_id: binding_ids)
          .update_all(next_reconcile_at: 1.minute.ago, claimed_until: nil, claim_token: nil)
      end

      metrics = {}
      GithubReconciliationService.new.call(now: Time.current, metrics: metrics)
      puts JSON.pretty_generate({ simulated: true, action: "reconcile", force_due: force_due, metrics: metrics })
    end

    def run_drain_issues!(argv)
      force_due = argv.include?("--force-due")
      meta = load_metadata!
      if force_due
        enrollment_ids = meta["personas"].values.filter_map { |p| p["enrollment_id"] }
        GithubIssueDelivery.where(enrollment_id: enrollment_ids, status: "pending")
          .update_all(next_retry_at: nil, claimed_until: nil, claim_token: nil)
      end

      metrics = {}
      GithubIssueDeliveryDrain.new.call(now: Time.current, metrics: metrics)
      puts JSON.pretty_generate({ simulated: true, action: "drain_issues", force_due: force_due, metrics: metrics })
    end

    def run_push_fix!(argv)
      meta = load_metadata!
      opts = { persona: "behind", sha: SHAS[:behind_fixed], exercise: "112.rb", code: nil, conclusion: "success", external_id: 911202 }
      OptionParser.new do |o|
        o.on("--persona VAL") { |v| opts[:persona] = v }
        o.on("--sha VAL") { |v| opts[:sha] = v }
        o.on("--exercise VAL") { |v| opts[:exercise] = v }
        o.on("--code VAL") { |v| opts[:code] = v }
        o.on("--conclusion VAL") { |v| opts[:conclusion] = v }
        o.on("--external-id VAL", Integer) { |v| opts[:external_id] = v }
      end.parse!(argv)

      p_meta = meta.dig("personas", opts[:persona])
      abort "Unknown persona: #{opts[:persona]}" unless p_meta && p_meta["repository_id"]

      repo_id_str = p_meta["repository_id"].to_s
      repo_full_name = p_meta["repo_full_name"]
      X6DemoFakeGithubClient.with_state(write: true) do |state|
        repo = state.dig("repositories", repo_id_str)
        abort "Simulated repo #{repo_id_str} missing" unless repo

        prev_sha = repo["head_sha"]
        prev_commit = repo.dig("commits", prev_sha) || {}
        existing_commit = repo.dig("commits", opts[:sha])
        files = if existing_commit
          (existing_commit["files"] || {}).dup
        else
          (prev_commit["files"] || {}).dup
        end

        if opts[:code]
          files[opts[:exercise]] = opts[:code]
        elsif opts[:exercise] == "112.rb"
          files["112.rb"] = SOURCES[:ex112_fixed]
        elsif opts[:exercise] == "113.rb"
          files["113.rb"] = SOURCES[:ex113_unsubmitted]
        end

        workflow_files = (prev_commit["workflow_files"] || {}).dup
        checks = if opts[:exercise] == "113.rb"
          []
        else
          [
            build_check_run_hash(
              external_id: opts[:external_id],
              name: "prework/#{opts[:exercise]}",
              sha: opts[:sha],
              repo_full_name: repo_full_name,
              status: "completed",
              conclusion: opts[:conclusion]
            )
          ]
        end

        repo["commits"][opts[:sha]] = {
          "files" => files,
          "workflow_files" => workflow_files,
          "checks" => checks
        }
        repo["head_sha"] = opts[:sha]
        repo["committed_at"] = Time.current.iso8601
      end

      puts JSON.pretty_generate(
        simulated: true,
        action: "push_fix",
        persona: opts[:persona],
        repository: repo_full_name,
        head_sha: opts[:sha],
        exercise: opts[:exercise],
        note: "Simulated local repository state updated (not a real GitHub push)."
      )
    end

    def run_simulate_outage!(argv)
      opts = { mode: "issue_failed", message: "Simulated GitHub outage — grade and feedback remain saved in Learn" }
      OptionParser.new do |o|
        o.on("--mode VAL") { |v| opts[:mode] = v }
        o.on("--message VAL") { |v| opts[:message] = v }
      end.parse!(argv)

      X6DemoFakeGithubClient.with_state(write: true) do |state|
        if opts[:mode] == "timeout_after_create"
          state["outage"] = { "enabled" => false, "mode" => "transient", "message" => opts[:message] }
          state["timeout_after_create_once"] = true
        else
          state["outage"] = { "enabled" => true, "mode" => opts[:mode], "message" => opts[:message] }
          state["timeout_after_create_once"] = false
        end
      end

      puts JSON.pretty_generate({ simulated: true, action: "simulate_outage", mode: opts[:mode], message: opts[:message] })
    end

    def run_recover_outage!
      X6DemoFakeGithubClient.with_state(write: true) do |state|
        state["outage"] = { "enabled" => false, "mode" => "transient", "message" => "" }
        state["timeout_after_create_once"] = false
      end
      puts JSON.pretty_generate({ simulated: true, action: "recover_outage", outage_enabled: false })
    end

    def run_preview_release!
      meta = load_metadata!
      cohort = Cohort.find(meta.fetch("cohort_id"))
      projection = CohortReleaseCommunications.new(cohort: cohort).call
      tick_ok = ScheduledTick.new(dry_run: true).call
      puts JSON.pretty_generate(
        simulated: true,
        action: "preview_release",
        scheduled_tick_dry_run_ok: tick_ok,
        release_communications: projection
      )
    end

    def run_window_toggle!(closed:)
      meta = load_metadata!
      cohort = Cohort.find(meta.fetch("cohort_id"))
      mod = CurriculumModule.find(meta.fetch("module_id"))
      if closed
        window = CohortModuleSubmissionWindow.find_or_initialize_by(cohort: cohort, curriculum_module: mod, week_number: 1)
        window.update!(submissions_close_at: 1.hour.ago, created_by_id: 1, updated_by_id: 1)
      else
        CohortModuleSubmissionWindow.where(cohort: cohort, curriculum_module: mod, week_number: 1).delete_all
      end
      puts JSON.pretty_generate({ simulated: true, action: closed ? "close_window" : "open_window", week: 1, closed: closed })
    end

    def current_status
      meta = load_metadata!
      cohort = Cohort.find(meta.fetch("cohort_id"))
      enrollment_ids = cohort.enrollments.pluck(:id)
      subs = Submission.where(enrollment_id: enrollment_ids).includes(:content_block, :submission_grade_suggestion, :github_check_runs, :github_issue_deliveries).order(:id)
      provider = X6DemoFakeGithubClient.with_state { |s| s }

      {
        simulated: true,
        cohort_id: cohort.id,
        submissions: subs.map do |s|
          {
            id: s.id,
            user_id: s.user_id,
            filename: s.content_block.filename,
            commit_sha: s.commit_sha,
            num_submissions: s.num_submissions,
            grade: s.grade,
            feedback: s.feedback,
            github_issue_url: s.github_issue_url,
            checks: s.github_check_runs.map { |c| { external_id: c.external_id, name: c.name, status: c.status, conclusion: c.conclusion, head_sha: c.head_sha } },
            suggestion: s.submission_grade_suggestion && {
              outcome: s.submission_grade_suggestion.outcome,
              suggested_grade: s.submission_grade_suggestion.suggested_grade,
              reason_code: s.submission_grade_suggestion.reason_code,
              decision: s.submission_grade_suggestion.decision,
              override_reason: s.submission_grade_suggestion.override_reason
            },
            issue_deliveries: s.github_issue_deliveries.order(:id).map { |d| { id: d.id, action: d.action, status: d.status, attempts: d.attempts, issue_number: d.issue_number, issue_url: d.issue_url, last_error: d.last_error } }
          }
        end,
        webhooks: GithubWebhookDelivery.order(:id).map { |w| { id: w.id, delivery_id: w.delivery_id, event: w.event, processing_state: w.processing_state, head_sha: w.head_sha } },
        simulated_provider_issues: provider["issues"],
        outage: provider["outage"]
      }
    end

    def load_metadata!
      abort "Demo metadata missing (#{METADATA_PATH}); run `setup` first" unless File.exist?(METADATA_PATH)

      JSON.parse(File.read(METADATA_PATH))
    end

    def read_web_port
      return ENV["QA_WEB_PORT"] if ENV["QA_WEB_PORT"].present?
      return JSON.parse(File.read(QA_STATE_PATH))["web_port"].to_s if File.exist?(QA_STATE_PATH)

      "5173"
    end

    def print_summary(meta)
      puts <<~TEXT
        === Wave 3 X-6.10: #{meta[:cohort_name]} (SIMULATED LOCAL HARNESS) ===
        Database: #{meta[:database]} (local csg_qa_* verified)
        Cohort ID: #{meta[:cohort_id]} | Module ID: #{meta[:module_id]} | Day 1 Lesson ID: #{meta[:lesson_id]}
        Exercises:
          1. 111.rb (id=#{meta[:exercises][:ex111][:id]}, policy=#{meta[:exercises][:ex111][:policy_id]}) — passing checks -> suggest_b
          2. 112.rb (id=#{meta[:exercises][:ex112][:id]}, policy=#{meta[:exercises][:ex112][:policy_id]}) — failed edge case -> review_for_redo -> Redo -> fix -> B
          3. 113.rb (id=#{meta[:exercises][:ex113][:id]}, policy=none) — unsubmitted / no-checks -> no_suggestion
        Simulated SHAs:
          demo-program initial: #{meta[:shas][:program_initial]}
          demo-behind initial:  #{meta[:shas][:behind_initial]}
          demo-behind fixed:    #{meta[:shas][:behind_fixed]}
        Expected initial counts: #{meta[:expected_initial_counts].to_json}
        Persona URLs:
          Admin (1):      #{meta[:personas][:admin][:url]}
          Instructor (2): #{meta[:personas][:instructor][:url]}
          Program (3):    #{meta[:personas][:program][:url]}
          Behind (4):     #{meta[:personas][:behind][:url]}
          Paused (5):     #{meta[:personas][:paused][:url]}
          Unrelated (6):  #{meta[:personas][:self_paced][:url]}
        Reset command:
          #{meta[:reset_command]}
        Metadata written to: #{METADATA_PATH}
        NOTE: All GitHub source, SHAs, checks, webhooks, issues, and receipts are SIMULATED locally.
      TEXT
    end
  end
end

X6ActualizeDemo.run!(ARGV) if $PROGRAM_NAME == __FILE__
