Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  get "health", to: proc { [ 200, { "Content-Type" => "application/json" }, [ '{"status":"ok"}' ] ] }

  namespace :api do
    namespace :v1 do
      # Auth
      post "sessions", to: "sessions#create"

      # Profile (current user)
      get "profile", to: "profile#show"
      patch "profile", to: "profile#update"

      # Dashboard / student hubs
      get "dashboard", to: "dashboard#show"
      get "recordings", to: "student_recordings#index"
      get "resources", to: "resources#index"

      # Watch progress (student updates their own)
      patch "watch_progress", to: "watch_progresses#update"
      get "watch_progress/student/:user_id", to: "watch_progresses#student_progress"

      # Users (admin)
      resources :users, only: [ :index, :show, :create, :update, :destroy ] do
        member do
          post :resend_invite
        end
      end

      # Curricula with nested modules
      resources :curricula, only: [ :index, :show, :create, :update, :destroy ] do
        resources :modules, only: [ :index, :create ]
      end

      # Modules (shallow) with nested lessons
      resources :modules, only: [ :show, :update, :destroy ] do
        resources :lessons, only: [ :index, :create ]
        post :exercises, to: "lessons#create_exercise"
      end

      # Lessons (shallow) with nested content blocks
      resources :lessons, only: [ :show, :update, :destroy ] do
        resources :content_blocks, only: [ :index, :create ]
      end

      # Generic video presign (staff, no content block needed)
      post "video_presign", to: "content_blocks#generic_video_presign"

      # Content blocks (shallow) with video endpoints
      resources :content_blocks, only: [ :show, :update, :destroy ] do
        member do
          post :video_presign
          get :video_stream
          patch :video_progress
        end
      end

      # Cohorts with nested enrollments
      resources :cohorts, only: [ :index, :show, :create, :update, :destroy ] do
        resources :enrollments, only: [ :index, :create ]
        member do
          patch :module_access
          patch :announcements
          patch :recordings
          patch :class_resources
        end
        # Cohort-scoped grading and GitHub sync per module
        get "modules/:module_id/submissions", to: "cohort_grading#index", as: :module_submissions
        post "modules/:module_id/sync_github", to: "cohort_grading#sync_all", as: :module_sync_github
        post "modules/:module_id/sync_github/:user_id", to: "cohort_grading#sync_student", as: :module_sync_student

        # S3-backed recordings
        resources :recordings, only: [ :index, :show, :create, :update, :destroy ] do
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
      resources :enrollments, only: [ :show, :update, :destroy ] do
        resources :module_assignments, only: [ :index, :create ]
        resources :lesson_assignments, only: [ :index, :create ]
      end

      # Access overrides (shallow)
      resources :module_assignments, only: [ :show, :update, :destroy ]
      resources :lesson_assignments, only: [ :show, :update, :destroy ]

      # Progress
      get "progress", to: "progress#index"
      patch "progress", to: "progress#update"
      get "progress/student/:user_id", to: "progress#student"

      # Submissions
      resources :submissions, only: [ :index, :show, :create, :update ] do
        member do
          patch :grade
          get :github_issue
        end
      end
    end
  end
end
