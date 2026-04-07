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
      get "recordings", to: "recordings#index"
      get "resources", to: "resources#index"

      # Users (admin)
      resources :users, only: [ :index, :show, :update ]

      # Curricula with nested modules
      resources :curricula, only: [ :index, :show, :create, :update, :destroy ] do
        resources :modules, only: [ :index, :create ]
      end

      # Modules (shallow) with nested lessons
      resources :modules, only: [ :show, :update, :destroy ] do
        resources :lessons, only: [ :index, :create ]
      end

      # Lessons (shallow) with nested content blocks
      resources :lessons, only: [ :show, :update, :destroy ] do
        resources :content_blocks, only: [ :index, :create ]
      end

      # Content blocks (shallow)
      resources :content_blocks, only: [ :show, :update, :destroy ]

      # Cohorts with nested enrollments
      resources :cohorts, only: [ :index, :show, :create, :update, :destroy ] do
        resources :enrollments, only: [ :index, :create ]
        member do
          patch :module_access
          patch :announcements
        end
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
        end
      end
    end
  end
end
