Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  get "up" => "rails/health#show", as: :rails_health_check
  get "health", to: "health#show", as: :health_check

  namespace :api do
    namespace :v1 do
      resources :submission_audits, only: [ :index, :update ]
      get "search", to: "search#index"
      resource :feature_settings, only: [ :show, :update ]
      get "cohorts/:cohort_id/feature_settings", to: "feature_settings#show"
      patch "cohorts/:cohort_id/feature_settings", to: "feature_settings#update"
      get "ready", to: "/readiness#show", as: :readiness_check

      namespace :home_base do
        resource :digest, only: :show, controller: :digests
      end

      # Assistant posting credentials (isolated from Clerk; see AgentPostingToken)
      namespace :agent do
        resources :messages, only: :create
      end
      resources :agent_posting_tokens, only: [ :index, :create ] do
        member { patch :revoke }
      end

      # Auth
      post "sessions", to: "sessions#create"
      get "course_offerings/:slug", to: "course_offerings#show"
      get "course_offerings", to: "course_offerings#index"
      get "course_checkouts", to: "course_checkouts#index"
      get "course_checkouts/:id/receipt", to: "course_checkouts#receipt"
      get "course_checkouts/:id/status", to: "course_checkouts#status"
      post "course_checkouts", to: "course_checkouts#create"
      post "course_checkout_webhooks", to: "course_checkout_webhooks#create"
      resources :activity_events, only: :index
      post "presence", to: "presence#create"
      post "web_handoffs", to: "web_handoffs#create"

      # Profile (current user)
      get "profile", to: "profile#show"
      patch "profile", to: "profile#update"
      resource :community_policy, only: :show do
        post :accept
      end
      resources :user_blocks, only: [ :index, :create, :destroy ], param: :blocked_user_id
      resources :content_reports, only: [ :index, :show, :create, :update ]
      # Admin-only, read-only: every block between two people (L-3.5).
      get "safety/user_blocks", to: "safety_user_blocks#index", as: :safety_user_blocks
      # Admin-only staff person record (L-3.6).
      resources :team_members, only: :show
      resources :data_deletion_requests, only: [ :index, :show, :create, :update ]

      # Dashboard / student hubs
      patch "dashboard/start_here", to: "dashboard#dismiss_start_here"
      get "dashboard", to: "dashboard#show"
      resources :private_meetings, only: [ :index, :create, :update, :destroy ]
      get "staff/private_meetings", to: "staff_private_meetings#index"
      patch "staff/private_meetings/:id", to: "staff_private_meetings#update"
      post "staff/private_meeting_configs", to: "staff_private_meeting_configs#create"
      post "staff/private_meeting_slots", to: "staff_private_meeting_slots#create"
      delete "staff/private_meeting_slots/:id", to: "staff_private_meeting_slots#destroy"
      get "weekly_plan", to: "weekly_plans#show"
      get "course_outline", to: "course_outlines#show"
      get "my_work", to: "my_works#show"
      get "support_queue", to: "support_queue#show"
      get "recordings", to: "student_recordings#index"
      get "resources", to: "resources#index"

      # Communication / notifications
      resources :announcements, only: [ :index, :show, :create, :update, :destroy ]
      post "cable_token", to: "cable_tokens#create"
      resources :notifications, only: [ :index ] do
        member do
          patch :read, to: "notifications#mark_read"
        end
        collection do
          patch :mark_all_read
        end
      end
      resources :help_requests, only: [ :index, :show, :create, :update ] do
        resources :replies, only: :create, controller: "help_request_replies"
      end
      resources :interventions, only: [ :index, :show, :create, :update ] do
        resources :notes, only: :create, controller: "intervention_notes"
      end
      resources :recovery_plans, only: [ :index, :show, :create, :update ] do
        resources :check_ins, only: :create, controller: "recovery_plan_check_ins"
      end
      get "push_subscriptions/config", to: "push_subscriptions#config"
      patch "push_subscriptions/preferences", to: "push_subscriptions#update_preferences"
      patch "push_subscriptions/web_preferences", to: "push_subscriptions#update_web_preferences"
      post "push_subscriptions", to: "push_subscriptions#create"
      delete "push_subscriptions", to: "push_subscriptions#destroy"
      post "mobile_push_tokens", to: "mobile_push_tokens#create"
      delete "mobile_push_tokens", to: "mobile_push_tokens#destroy"
      get "mobile_push_tokens/config", to: "mobile_push_tokens#show_config"
      patch "mobile_push_tokens/preferences", to: "mobile_push_tokens#update_preferences"
      post "message_attachments/presign", to: "message_attachments#presign"
      post "transcriptions", to: "transcriptions#create"
      patch "message_preferences", to: "message_preferences#update"
      patch "editor_preferences", to: "editor_preferences#update"
      get "nudge_preferences", to: "nudge_preferences#show"
      patch "nudge_preferences", to: "nudge_preferences#update"
      get "messages/search", to: "messages_search#index"
      # Peek cards (L-0.5)
      get "records/:type/:id/summary", to: "record_summaries#show", as: :record_summary
      get "records/:type/:id/related", to: "record_summaries#related", as: :record_related
      get "records/:type/:id/usage", to: "record_summaries#usage", as: :record_usage
      get "records/:type/:id/detail", to: "record_summaries#detail", as: :record_detail
      resources :workspaces, only: [ :index, :show, :create, :update ] do
        resources :memberships, only: [ :create, :destroy ], controller: "workspace_memberships"
      end
      resources :channels, only: [ :index, :show, :create, :update, :destroy ] do
        member do
          patch :read, to: "channels#mark_read"
        end
        resources :messages, only: [ :create ]
      end
      resources :direct_conversations, only: [ :index, :show, :create ] do
        collection do
          get :available_users
        end
        member do
          patch :read, to: "direct_conversations#mark_read"
        end
      end
      post "direct_conversations/:direct_conversation_id/messages", to: "messages#create_direct"
      resources :messages, only: [ :update, :destroy ] do
        member do
          get :destination
          get :thread
          patch :pin
          delete :pin, action: :unpin
          post :reactions, action: :react
          delete :reactions, action: :unreact
        end
      end

      # Watch progress (student updates their own)
      patch "watch_progress", to: "watch_progresses#update"
      get "watch_progress/student/:user_id", to: "watch_progresses#student_progress"
      get "watch_progress/student/:user_id/lesson_videos", to: "watch_progresses#student_lesson_video_progress"

      # Users (admin)
      resources :users, only: [ :index, :show, :create, :update, :destroy ] do
        member do
          post :resend_invite
          patch :unarchive
        end
      end

      post "course_packages/preview", to: "course_packages#preview"
      resources :course_packages, only: [ :create ]

      post "curricula/:id/clone", to: "authoring_clones#create", defaults: { kind: "curriculum" }
      post "modules/:id/clone", to: "authoring_clones#create", defaults: { kind: "module" }
      post "cohorts/:id/clone", to: "authoring_clones#create", defaults: { kind: "cohort" }

      # Curricula with nested modules
      resources :curricula, only: [ :index, :show, :create, :update, :destroy ] do
        resources :resources, only: [ :index, :create, :destroy ], controller: "curriculum_resources" do
          member do
            post :complete
            post :download
          end
        end
        post "modules/reorder", to: "modules#reorder"
        resources :modules, only: [ :index, :create ]
      end
      resources :learning_objectives, only: [ :index, :create, :update, :destroy ]
      resources :rubrics, only: [ :index, :create, :update, :destroy ]
      resources :feedback_snippets, only: [ :index, :create, :update, :destroy ] do
        member do
          post :use
        end
      end
      resources :knowledge_checks, only: [] do
        resources :attempts, only: :create, controller: "knowledge_check_attempts"
      end

      # Modules (shallow) with nested lessons
      resources :modules, only: [ :show, :update, :destroy ] do
        resources :lessons, only: [ :index, :create ]
        post :exercises, to: "lessons#create_exercise"
      end

      # Lessons (shallow) with nested content blocks
      resources :lessons, only: [ :show, :update, :destroy ] do
        member do
          patch :editor, to: "lessons#update_editor"
          patch :archive
          patch :restore
          post :move
          post :duplicate
        end
        resources :content_blocks, only: [ :index, :create ]
        resource :objective_alignments, only: :update
        resource :block_editor, only: [ :show, :update ], controller: "lesson_block_editors"
      end

      # Generic video presign (staff, no content block needed)
      post "video_presign", to: "content_blocks#generic_video_presign"

      # Orphan S3 cleanup: called by the upload UI when a presigned PUT
      # succeeds but the follow-up DB write fails.
      delete "uploads/abandon", to: "uploads#abandon"
      post "uploads/multipart/initiate", to: "uploads#multipart_initiate"
      post "uploads/multipart/part_url", to: "uploads#multipart_part_url"
      post "uploads/multipart/complete", to: "uploads#multipart_complete"
      delete "uploads/multipart/abort", to: "uploads#multipart_abort"

      # Content blocks (shallow) with video endpoints
      resources :content_blocks, only: [ :show, :update, :destroy ] do
        resource :check_policy, only: [ :show, :update, :destroy ], controller: "exercise_check_policies"
        member do
          post :video_presign
          get :video_stream
          patch :video_progress
        end
      end

      post "github_identity/callback", to: "github_identities#callback"
      post "enrollments/:enrollment_id/github_identity/prepare", to: "github_identities#prepare"
      post "github_app/setup", to: "github_app_installations#callback"

      # Cohorts with nested enrollments
      resources :cohorts, only: [ :index, :show, :create, :update, :destroy ] do
        collection do
          get :accessible
        end
        post "setup_readiness", on: :member
        post "enrollments/bulk", to: "enrollments#bulk"
        resources :github_app_installations, only: [ :index, :create ] do
          post :prepare, on: :collection
        end
        resources :enrollments, only: [ :index, :create ]
        resources :instructor_assignments, only: [ :index, :create, :destroy ], controller: "cohort_instructor_assignments" do
          patch :lesson_editing, on: :member
        end
        resource :learning_insights, only: :show, controller: "cohort_learning_insights"
        resource :release_communications, only: :show, controller: "cohort_release_communications"
        # "Make a copy for this cohort": GET previews, POST copies.
        resource :curriculum_copy, only: [ :show, :create ], controller: "curriculum_copies"
        member do
          get :home
          get :student_view
          get :github_access
          patch :module_access
          patch :announcements
          patch :class_resources
        end
        # Cohort-scoped grading and GitHub sync per module
        get "modules/:module_id/submissions", to: "cohort_grading#index", as: :module_submissions
        post "modules/:module_id/sync_github", to: "cohort_grading#sync_all", as: :module_sync_github
        post "modules/:module_id/sync_github/:user_id", to: "cohort_grading#sync_student", as: :module_sync_student
        patch "modules/:module_id/submission_windows", to: "cohort_module_submission_windows#update", as: :module_submission_windows

        resources :office_hours, only: [ :index, :create, :update, :destroy ]

        # S3-backed recordings
        resources :recordings, only: [ :index, :show, :create, :update, :destroy ] do
          get :lesson_options, on: :collection
          member do
            get :stream_url
          end
        end
        post "recordings_presign", to: "recordings#presign"
        patch "recordings_reorder", to: "recordings#reorder"
        get "watch_progress", to: "watch_progresses#cohort_progress"
        get "lesson_video_progress", to: "watch_progresses#cohort_lesson_video_progress"
      end

      # Enrollments with access overrides
      get "certificates/:code", to: "certificates#show"
      resources :enrollments, only: [ :show, :update, :destroy ] do
        resource :certificate, only: [ :show, :update ], controller: "enrollment_certificates" do
          post :revoke
          post :reissue
        end
        resources :github_repository_bindings, only: [ :index, :create ] do
          post :verify, on: :member
        end
        resource :learning_plan, only: [ :show, :update ]
        resources :extensions, only: [ :index, :create, :update, :destroy ], controller: "learner_extensions"
        resources :nudges, only: :index, controller: "learner_nudges"
        resource :pace, only: [ :show, :update ], controller: "personal_paces"
        resources :module_assignments, only: [ :index, :create ]
        resources :lesson_assignments, only: [ :index, :create ]
        resource :restart, only: :create, controller: "enrollment_restarts"
      end

      # Access overrides (shallow)
      resources :module_assignments, only: [ :show, :update, :destroy ]
      resources :lesson_assignments, only: [ :show, :update, :destroy ]

      # Progress
      get "progress", to: "progress#index"
      patch "progress", to: "progress#update"
      get "progress/student/:user_id", to: "progress#student"
      get "progress/student/:user_id/communication", to: "student_communications#show"

      # Submissions
      get "grading_queue", to: "grading_queue#index"
      resources :submissions, only: [ :index, :show, :create, :update ] do
        resource :github_checks, only: [ :show, :create ], controller: "submission_github_checks"
        member do
          patch :grade
          get :github_issue
          post :retry_github_issue
          post :evaluate_grade_suggestion
        end
      end
    end
  end
end
